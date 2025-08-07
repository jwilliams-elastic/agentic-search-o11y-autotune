import { Client } from '@elastic/elasticsearch';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { config } from 'dotenv';
import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';

config();

const inputSchema = z.object({
  elasticUrl: z.string().url().optional().describe('Base URL of the Elasticsearch instance. Defaults to ELASTIC_URL from .env'),
  elasticApiKey: z.string().optional().describe('Elasticsearch API Key. Defaults to ELASTIC_API_KEY from .env'),
  indexName: z.string().optional().describe('Name of the Elasticsearch index to delete. Defaults to INDEX_NAME from .env'),
  dataStreamName: z.string().optional().describe('Name of the Elasticsearch datastream to delete. Defaults to ELASTIC_LOGS_DATA_STREAM from .env'),
  inferenceId: z.string().optional().describe('ID for the inference endpoint to delete. Defaults to INFERENCE_ID from .env'),
  templatesDir: z.string().optional().describe('Absolute path to the directory containing search template files (.mustache). Defaults to SEARCH_TEMPLATES_DIR from .env')
});

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z.record(z.string(), z.any()).optional(),
});

const teardownElasticsearch = async ({
  elasticUrl,
  elasticApiKey,
  indexName,
  dataStreamName,
  inferenceId,
  templatesDir,
}: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> => {

  // Instantiate Elastic client with API key auth
  const client = new Client({
    node: elasticUrl,
    auth: { apiKey: elasticApiKey! },
  });

  const results: Record<string, any> = {};
  let allSuccessful = true;

  // Delete all search templates from the search_templates directory
  try {
    const dir = templatesDir || process.env.SEARCH_TEMPLATES_DIR || './search_templates';
    const files = await fs.readdir(dir);
    const templateFiles = files.filter(file => file.endsWith('.mustache'));
    
    if (templateFiles.length === 0) {
      results.template = { success: true, message: 'No search templates found to delete.' };
    } else {
      const deletedTemplates = [];
      const errors = [];
      
      for (const file of templateFiles) {
        const templateId = file.replace(/\.mustache$/, '');
        try {
          await client.deleteScript({ id: templateId });
          deletedTemplates.push(templateId);
        } catch (error: any) {
          if (error?.meta?.body?.error?.type !== 'resource_not_found_exception') {
            errors.push(`${templateId}: ${error?.meta?.body?.error?.reason || error.message}`);
          }
        }
      }
      
      if (errors.length > 0) {
        results.template = {
          success: false,
          message: `Error deleting some templates: ${errors.join('; ')}`,
          deletedTemplates,
          errors
        };
        allSuccessful = false;
      } else {
        results.template = { 
          success: true, 
          message: deletedTemplates.length > 0 
            ? `Successfully deleted search templates: ${deletedTemplates.join(', ')}`
            : 'No active search templates found to delete.'
        };
      }
    }
  } catch (error: any) {
    results.template = {
      success: false,
      message: `Error processing templates: ${error.message}`
      };
      allSuccessful = false;
    }
  

  // Delete index if it exists
  if (indexName) {
    try {
      const indexExists = await client.indices.exists({ index: indexName });

      if (indexExists) {
        await client.indices.delete({ index: indexName });
        results.index = { success: true, message: `Index '${indexName}' deleted.` };
      } else {
        results.index = { success: true, message: `Index '${indexName}' does not exist, skipping delete.` };
      }
    } catch (error: any) {
      results.index = {
        success: false,
        message: `Error deleting index '${indexName}': ${error?.meta?.body?.error?.reason || error.message}`
      };
      allSuccessful = false;
    }
  }

  // Delete data stream if it exists
  dataStreamName = dataStreamName || process.env.ELASTIC_LOGS_DATA_STREAM;
  if (dataStreamName) {
    let dsSuccess = true;
    let dsMessage = '';
    try {
      try {
        // Attempt to retrieve the data stream
        await client.indices.getDataStream({ name: dataStreamName });

        // If no error was thrown, the data stream exists
        await client.indices.deleteDataStream({ name: dataStreamName });
        dsMessage = `Deleted data stream: ${dataStreamName}`;
        console.log(dsMessage);
      } catch (err: any) {
        // If the error is a 404, the data stream does not exist
        if (err.meta?.statusCode === 404) {
          dsMessage = `Data stream not found: ${dataStreamName} (skipping delete)`;
          console.log(dsMessage);
        } else {
          // Unexpected error — rethrow it
          throw err;
        }
      }
    } catch (error: any) {
      dsSuccess = false;
      dsMessage = `Error deleting data stream '${dataStreamName}': ${error?.meta?.body?.error?.reason || error.message}`;
      allSuccessful = false;
    }
    results.dataStream = {
      success: dsSuccess,
      message: dsMessage
    };
  }

  // Delete inference endpoint
  if (inferenceId && elasticUrl && elasticApiKey) {
    try {
      const url = `${elasticUrl}/_inference/text_embedding/${inferenceId}`;
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `ApiKey ${elasticApiKey}`
      };

      const response = await axios.delete(url, { headers });

      if (response.status === 200) {
        results.inference = {
          success: true,
          message: 'Text embedding endpoint deleted successfully',
          data: response.data
        };
      } else {
        results.inference = {
          success: false,
          message: `Error: ${response.status}, ${response.statusText}`
        };
        allSuccessful = false;
      }
    } catch (error: any) {
      results.inference = {
        success: false,
        message: `Error deleting inference endpoint: ${error.response?.data?.error || error.message}`
      };
      allSuccessful = false;
    }
  }

  return {
    success: allSuccessful,
    message: allSuccessful
      ? 'All Elasticsearch resources deleted successfully.'
      : 'Some Elasticsearch resources could not be deleted. Check details for more information.',
    details: results
  };
};

export const elasticsearchTeardownTool = createTool({
  id: 'elasticsearch-teardown',
  description: 'Delete Elasticsearch resources including indices, search templates, and inference endpoints.',
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    const elasticUrl = context.elasticUrl ?? process.env.ELASTIC_URL;
    const elasticApiKey = context.elasticApiKey ?? process.env.ELASTIC_API_KEY;
    const indexName = context.indexName ?? process.env.INDEX_NAME;
    const inferenceId = context.inferenceId ?? process.env.INFERENCE_ID;
    const templateId = context.templateId ?? process.env.TEMPLATE_ID;

    if (!elasticUrl || !elasticApiKey) {
      throw new Error(
        'Missing required configuration: elasticUrl and elasticApiKey must be provided either in the tool input or as environment variables.'
      );
    }

    return await teardownElasticsearch({
      elasticUrl,
      elasticApiKey,
      indexName,
      inferenceId,
      templateId
    });
  },
});
