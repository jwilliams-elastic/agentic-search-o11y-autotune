import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { config } from 'dotenv';
import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';
import { expandEnvVars } from '../../utils/env';

config();

const inputSchema = z.object({
  elasticUrl: z.string().url().optional().describe('Base URL of the Elasticsearch instance. Defaults to ELASTIC_URL from .env'),
  kibanaUrl: z.string().url().optional().describe('Base URL of the Kibana instance. Derived from elasticUrl'),
  elasticApiKey: z.string().optional().describe('Elasticsearch API Key. Defaults to ELASTIC_API_KEY from .env'),
  dashboardFilePath: z.string().default(`${process.env.PROJECT_HOME || ''}/dashboards/sample_kibana_dashboard.ndjson`).describe('Path to the .ndjson dashboard file to import.'),
});

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z.record(z.string(), z.any()).optional(),
});

const importKibanaDashboard = async ({
  kibanaUrl,
  elasticApiKey,
  dashboardFilePath,
}: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> => {
  const url = `${kibanaUrl}/api/saved_objects/_import?overwrite=true`;
  const apiKey = elasticApiKey;
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(dashboardFilePath));
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'kbn-xsrf': 'true',
        'Authorization': `ApiKey ${apiKey}`,
        ...form.getHeaders(),
      },
      body: form as any,
    });
    const data = await response.json();
    if (response.ok) {
      return { success: true, message: 'Dashboard imported successfully.', details: data };
    } else {
      return { success: false, message: `Error: ${response.status} ${response.statusText}`, details: data };
    }
  } catch (error: any) {
    return { success: false, message: `Exception: ${error.message}` };
  }
};

export const elasticsearchDashboardSetupTool = createTool({
  id: 'elasticsearch-dashboard-setup-tool',
  description: 'Import a Kibana dashboard (.ndjson) into Elasticsearch via the Saved Objects API.',
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    const elasticUrl = context.elasticUrl ?? process.env.ELASTIC_URL;
    const kibanaUrl = elasticUrl ? elasticUrl.replace('.es', '.kb') : undefined;
    const elasticApiKey = context.elasticApiKey ?? process.env.ELASTIC_API_KEY;
    const dashboardFilePath = context.dashboardFilePath;

    if (!elasticUrl || !elasticApiKey || !dashboardFilePath) {
      throw new Error('Missing required configuration: elasticUrl, elasticApiKey, and dashboardFilePath must be provided either in the tool input or as environment variables.');
    }

    return await importKibanaDashboard({
      kibanaUrl,
      elasticApiKey,
      dashboardFilePath,
    });
  },
});