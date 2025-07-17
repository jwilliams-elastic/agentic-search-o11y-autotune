import { Client } from '@elastic/elasticsearch';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { config } from 'dotenv';

config();

const inputSchema = z.object({
  elasticUrl: z.string().url().optional().describe('Base URL of the Elasticsearch instance. Defaults to ELASTIC_URL from .env'),
  elasticApiKey: z.string().optional().describe('Elasticsearch API Key. Defaults to ELASTIC_API_KEY from .env'),
  indexName: z.string().optional().describe('Name for the Elasticsearch index. Defaults to INDEX_NAME from .env'),
  inferenceId: z.string().optional().describe('ID for the inference endpoint. Defaults to INFERENCE_ID from .env'),
});

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z.record(z.string(), z.any()).optional(),
});

const createIndex = async ({
  elasticUrl,
  elasticApiKey,
  indexName,
  inferenceId,
}: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> => {
  // Instantiate Elastic client with API key auth
  const indexUrl = `${elasticUrl}/${indexName}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `ApiKey ${elasticApiKey}`,
  };
  const mapping = {
    dynamic: 'false',
    properties: {
      'annual-tax': { type: 'integer' },
      full_html: { type: 'text', index: false },
      geo_point: {
        properties: {
          lat: { type: 'float' },
          lon: { type: 'float' },
        },
      },
      location: { type: 'geo_point' },
      headings: { type: 'text' },
      'home-price': { type: 'integer' },
      id: { type: 'keyword' },
      latitude: { type: 'float' },
      'listing-agent-info': { type: 'text' },
      longitude: { type: 'float' },
      'maintenance-fee': { type: 'integer' },
      meta_keywords: { type: 'keyword' },
      'number-of-bathrooms': { type: 'float' },
      'number-of-bedrooms': { type: 'float' },
      'property-description': {
        type: 'text',
        copy_to: ['property-description_semantic'],
      },
      'property-description_semantic': {
        type: 'semantic_text',
        inference_id: inferenceId,
      },
      'property-features': {
        type: 'text',
        copy_to: ['property-features_semantic'],
        fields: { keyword: { type: 'keyword' } },
      },
      'property-features_semantic': {
        type: 'semantic_text',
        inference_id: inferenceId,
      },
      'property-status': { type: 'keyword' },
      'square-footage': { type: 'float' },
      title: { type: 'text' },
    },
  };
  // Instantiate Elastic client with API key auth
  const client = new Client({
    node: elasticUrl,
    auth: { apiKey: elasticApiKey! },
  });
  try {
    await client.indices.create({
      index: indexName!,
      body: { mappings: mapping },
    });
    return { success: true, message: `Index '${indexName}' created successfully.` };
  } catch (error: any) {
    return { success: false, message: `Error: ${error?.meta?.statusCode || error.statusCode || 'unknown'}, ${error?.meta?.body?.error?.reason || error.message}` };
  }
};

export const elasticsearchIndexSetupTool = createTool({
  id: 'create-elasticsearch-index',
  description: 'Create a new index in Elasticsearch with a custom mapping, supporting semantic_text fields.',
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    const elasticUrl = context.elasticUrl ?? process.env.ELASTIC_URL;
    const elasticApiKey = context.elasticApiKey ?? process.env.ELASTIC_API_KEY;
    const indexName = context.indexName ?? process.env.INDEX_NAME;
    const inferenceId = context.inferenceId ?? process.env.INFERENCE_ID;

    if (!elasticUrl || !elasticApiKey || !indexName || !inferenceId) {
      throw new Error(
        'Missing required configuration: elasticUrl, elasticApiKey, indexName, or inferenceId must be provided either in the tool input or as environment variables.'
      );
    }

    return await createIndex({ elasticUrl, elasticApiKey, indexName, inferenceId });
  },
});
