import { createWorkflow } from '@mastra/core/workflows';
import { elasticsearchIndexSetupTool } from '../tools/elasticsearch-index-setup-tool';
import { elasticsearchMlSetupTool } from '../tools/elasticsearch-ml-setup-tool';
import { elasticsearchSearchTemplateSetupTool } from '../tools/elasticsearch-search-template-setup-tool';
import { elasticsearchIndexDataloadTool } from '../tools/elasticsearch-index-dataload-tool';
import { elasticsearchTeardownTool } from '../tools/elasticsearch-teardown-tool';
import { z } from 'zod';

import { createStep } from '@mastra/core/workflows';

const workflowInputSchema = z.object({
  indexName: z.string().optional(),
  elasticUrl: z.string().url().optional(),
  elasticApiKey: z.string().optional(),
  dataFile: z.string().optional(),
  inferenceId: z.string().optional(),
  modelId: z.string().optional(),
  numAllocations: z.number().optional()
});

const workflowOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z.record(z.string(), z.any()).optional(),
});

const teardownElasticsearch = createStep({
    id: 'elasticsearch-teardown',
    inputSchema: workflowInputSchema,
    outputSchema: workflowOutputSchema,
    execute: async ({ inputData, runtimeContext }) => {
      // Ensure we provide all required fields with defaults
      const toolInput = {
        elasticUrl: inputData.elasticUrl,
        elasticApiKey: inputData.elasticApiKey,
        indexName: inputData.indexName,
        inferenceId: inputData.inferenceId,
        templateId: inputData.templateId,
        numAllocations: inputData.numAllocations
      };
      const toolResult = await elasticsearchTeardownTool.execute({ context: toolInput, runtimeContext });
      return { ...inputData, ...toolResult }; // propagate all inputData fields forward
    },
  });

const mlSetupStep = createStep({
  id: 'ml-setup',
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData, runtimeContext }) => {
    // Ensure required fields are provided with defaults
    const toolInput = {
      elasticUrl: inputData.elasticUrl,
      elasticApiKey: inputData.elasticApiKey,
      inferenceId: inputData.inferenceId,
      modelId: inputData.modelId,
      numAllocations: inputData.numAllocations,
    };

    const toolResult = await elasticsearchMlSetupTool.execute({ context: toolInput, runtimeContext });
    return { ...inputData, ...toolResult }; // propagate all inputData fields forward
  },
});

const indexSetupStep = createStep({
  id: 'index-setup',
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData, runtimeContext }) => {
    const toolResult = await elasticsearchIndexSetupTool.execute({ context: inputData, runtimeContext });
    return { ...inputData, ...toolResult }; // propagate all inputData fields forward
  },
});

const searchTemplateSetupStep = createStep({
  id: 'search-templates-setup',
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData, runtimeContext }) => {
    const toolInput = {
      elasticUrl: inputData.elasticUrl,
      elasticApiKey: inputData.elasticApiKey,
      indexName: inputData.indexName, // Add indexName to make the type compatible
      inferenceId: inputData.inferenceId, // Add inferenceId to make the type compatible
    };
    const toolResult = await elasticsearchSearchTemplateSetupTool.execute({ context: toolInput, runtimeContext });
    return { ...inputData, ...toolResult }; // propagate all inputData fields forward
  },
});

const dataloadStep = createStep({
  id: 'dataload',
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData, runtimeContext }) => {
    // Ensure we pass all the expected parameters
    // The tool will handle defaults from environment variables for optional string fields
    // For numeric fields, we need to provide the default values here
    const toolInput = {
      elasticUrl: inputData.elasticUrl,
      elasticApiKey: inputData.elasticApiKey,
      indexName: inputData.indexName,
      dataFile: inputData.dataFile
    };
    const toolResult = await elasticsearchIndexDataloadTool.execute({ context: toolInput, runtimeContext });
    return { ...inputData, ...toolResult }; // propagate all inputData fields forward
  },
});

// Create a final completion step to properly mark the workflow as complete
const completionStep = createStep({
  id: 'workflow-completion',
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData }) => {
    // The inputData here will be the output from the dataloadStep
    return {
      success: inputData.success,
      message: 'Elasticsearch setup workflow completed successfully: ' + inputData.message,
      recordsLoaded: inputData.recordsLoaded,
    };
  },
});

const elasticsearchSetupWorkflow = createWorkflow({
  id: 'elasticsearch-setup-workflow',
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
  .then(teardownElasticsearch)
  .then(mlSetupStep)
  .then(indexSetupStep)
  .then(searchTemplateSetupStep)
  .then(dataloadStep)
  .then(completionStep);

elasticsearchSetupWorkflow.commit();

export { elasticsearchSetupWorkflow };
