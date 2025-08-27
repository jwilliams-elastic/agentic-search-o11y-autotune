import { Client } from '@elastic/elasticsearch';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { config } from 'dotenv';
import { expandEnvVars } from '../../utils/env';

config();

const inputSchema = z.object({
  elasticUrl: z.string().url().optional().describe('Base URL of the Elasticsearch instance. Defaults to ELASTIC_URL from .env'),
  inferenceId: z.string().optional().describe('ID for the inference endpoint. Defaults to INFERENCE_ID from .env'),
  elasticApiKey: z.string().optional().describe('Elasticsearch API Key. Defaults to ELASTIC_API_KEY from .env'),
  modelId: z.string().optional().describe('Model ID for the text embedding. Defaults to MODEL_ID from .env'),
  numAllocations: z.number().default(4).optional().describe('Number of allocations for the inference endpoint. Defaults to 4.'),
});

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z.record(z.string(), z.any()).optional(),
});

const createTextEmbeddingEndpoint = async ({
  elasticUrl,
  inferenceId,
  elasticApiKey,
  modelId,
  numAllocations,
}: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> => {
  const client = new Client({
    node: elasticUrl,
    auth: { apiKey: elasticApiKey! },
  });
  const path = `/_inference/text_embedding/${inferenceId}`;
  const payload = {
    service: 'elasticsearch',
    service_settings: {
      model_id: modelId,
      num_threads: 1,
      num_allocations: numAllocations,
    },
  };
  try {
    const body = await client.transport.request({
      method: 'PUT',
      path,
      body: payload,
    });
    // If the request succeeds, the client returns the body directly.
    // We can assume a 2xx status code.
    const statusCode = 200; // Assuming success
    console.log(`Creating text embedding endpoint. Status: ${statusCode}`);
    console.log(`Text embedding endpoint. Body: ${JSON.stringify(body, null, 2)}`);
    
    return { success: true, message: 'Text embedding endpoint created successfully.' };
  } catch (error: any) {
    const statusCode = error?.meta?.statusCode || error.statusCode || 'unknown';
    const errorMessage = error?.meta?.body?.error?.reason || error.message;
    console.log(`Error creating text embedding endpoint. Status: ${statusCode}`, error);
    return { success: false, message: `Error: ${statusCode}, ${errorMessage}` };
  }
};

export const elasticsearchMlSetupTool = createTool({
  id: 'create-elasticsearch-ml-endpoint',
  description: 'Create a text_embedding endpoint in Elasticsearch with explicit min/max allocations and chunk settings.',
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    const elasticUrl = context.elasticUrl ?? process.env.ELASTIC_URL;
    const elasticApiKey = context.elasticApiKey ?? process.env.ELASTIC_API_KEY;
    const modelId = context.modelId ?? process.env.MODEL_ID;
    const inferenceId = context.inferenceId ?? process.env.INFERENCE_ID;
    const numAllocations = context.numAllocations ?? 1;

    if (!elasticUrl || !elasticApiKey || !modelId || !inferenceId || !numAllocations) {
      throw new Error('Missing required configuration: elasticUrl, elasticApiKey, modelId, numAllocations, or inferenceId must be provided either in the tool input or as environment variables (ELASTIC_URL, ELASTIC_API_KEY, MODEL_ID, INFERENCE_ID).');
    }

    return await createTextEmbeddingEndpoint({
      elasticUrl,
      inferenceId,
      elasticApiKey,
      modelId,
      numAllocations,
    });
  },
});
