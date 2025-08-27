import { Client } from '@elastic/elasticsearch';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { config } from 'dotenv';
import { readFile, readdir } from 'fs/promises';
import { resolve } from 'path';
import { expandEnvVars } from '../../utils/env';

config();

const inputSchema = z.object({
  elasticUrl: z.string().url().optional().describe('Base URL of the Elasticsearch instance. Defaults to ELASTIC_URL from .env'),
  elasticApiKey: z.string().optional().describe('Elasticsearch API Key. Defaults to ELASTIC_API_KEY from .env'),
  templatesDir: z.string().optional().describe('Absolute path to the directory containing search template files (.mustache). Defaults to SEARCH_TEMPLATES_DIR from .env')
});

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z.object({
    processed: z.number(),
    failed: z.number(),
    results: z.array(z.object({
      id: z.string(),
      success: z.boolean(),
      message: z.string(),
      error: z.string().optional()
    }))
  })
});

/**
 * Reads a template file from the filesystem
 */
async function readTemplateFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read template file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface TemplateFile {
  id: string;
  filePath: string;
}

async function getTemplateFiles(dirPath: string): Promise<TemplateFile[]> {
  try {
    const files = await readdir(dirPath);
    return files
      .filter((file: string) => file.endsWith('.mustache'))
      .map((file: string) => ({
        id: file.replace(/\.mustache$/, ''),
        filePath: resolve(dirPath, file)
      }));
  } catch (error) {
    throw new Error(`Failed to read template directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Processes a single template and uploads it to Elasticsearch
 */
interface TemplateConfig {
  id: string;
  filePath: string;
  lang: string;
}

async function processTemplate(
  client: Client,
  template: TemplateConfig
): Promise<{ id: string; success: boolean; message: string; error?: string }> {
  try {
    const templateSource = await readTemplateFile(template.filePath);
    
    // Using the _scripts API endpoint directly to work around type issues
    await client.transport.request({
      method: 'PUT',
      path: `/_scripts/${template.id}`,
      body: {
        script: {
          lang: template.lang,
          source: templateSource
        }
      }
    });
    
    return {
      id: template.id,
      success: true,
      message: `Successfully uploaded template '${template.id}'`
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      id: template.id,
      success: false,
      message: `Failed to process template '${template.id}'`,
      error: errorMessage
    };
  }
}



const createSearchTemplates = async (params: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> => {
  // Get values from params or environment variables
  const elasticUrl = params.elasticUrl || process.env.ELASTIC_URL;
  const elasticApiKey = params.elasticApiKey || process.env.ELASTIC_API_KEY;
  
  // Validate required parameters
  if (!elasticUrl) {
    return { 
      success: false, 
      message: 'elasticUrl is required but not provided and ELASTIC_URL environment variable is not set',
      details: { processed: 0, failed: 0, results: [] }
    };
  }
  if (!elasticApiKey) {
    return { 
      success: false, 
      message: 'elasticApiKey is required but not provided and ELASTIC_API_KEY environment variable is not set',
      details: { processed: 0, failed: 0, results: [] }
    };
  }
  
  const client = new Client({
    node: elasticUrl,
    auth: { apiKey: elasticApiKey },
  });
  
  const results = [];
  let processed = 0;
  let failed = 0;
  
  try {
    // Get all template files from the directory
    let templatesDir = params.templatesDir || process.env.SEARCH_TEMPLATES_DIR || './search_templates';
    templatesDir = expandEnvVars(templatesDir);
    if (!templatesDir) {
      return {
        success: false,
        message: 'No templates directory specified. Please provide templatesDir parameter or set SEARCH_TEMPLATE_DIR environment variable.',
        details: { processed: 0, failed: 0, results: [] }
      };
    }
    const templates = await getTemplateFiles(templatesDir);
    
    if (templates.length === 0) {
      return {
        success: false,
        message: `No .mustache files found in directory: ${params.templatesDir}`,
        details: { processed: 0, failed: 0, results: [] }
      };
    }
    
    // Process all templates in parallel
    const templatePromises = templates.map(({ id, filePath }) => 
      processTemplate(client, { id, filePath, lang: 'mustache' })
    );
    
    const templateResults = await Promise.all(templatePromises);
    
    // Count successful and failed operations
    for (const result of templateResults) {
      results.push(result);
      if (result.success) {
        processed++;
      } else {
        failed++;
      }
    }
    
    return {
      success: failed === 0,
      message: failed === 0 
        ? `Successfully processed ${processed} template(s)`
        : `Processed ${processed} template(s) successfully, but failed to process ${failed} template(s)`,
      details: {
        processed,
        failed,
        results
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `Error processing templates: ${errorMessage}`,
      details: {
        processed,
        failed,
        results
      }
    };
  }
};

export const elasticsearchSearchTemplateSetupTool = createTool({
  id: 'create-elasticsearch-search-templates',
  description: `Uploads all search templates from a directory to Elasticsearch. All .mustache files in the specified directory 
                will be uploaded as search templates. The template ID will be the filename without the .mustache extension.`,
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    return await createSearchTemplates(context);
  },
});
