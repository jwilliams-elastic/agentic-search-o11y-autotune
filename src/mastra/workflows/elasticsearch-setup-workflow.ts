import { createWorkflow } from '@mastra/core/workflows';
import { elasticsearchIndexSetupTool } from '../tools/elasticsearch-index-setup-tool';
import { elasticsearchMlSetupTool } from '../tools/elasticsearch-ml-setup-tool';
import { elasticsearchSearchTemplateSetupTool } from '../tools/elasticsearch-search-template-setup-tool';
import { elasticsearchIndexDataloadTool } from '../tools/elasticsearch-index-dataload-tool';
import { elasticsearchTeardownTool } from '../tools/elasticsearch-teardown-tool';
import { elasticsearchDashboardSetupTool } from '../tools/elasticsearch-dashboard-setup-tool';
import { z } from 'zod';
import { expandEnvVars } from '../../utils/env';

import { createStep } from '@mastra/core/workflows';
import path from 'path';

const workflowInputSchema = z.object({
  indexName: z.string().optional().describe('Name for the Elasticsearch index. Defaults to INDEX_NAME from .env'),
  elasticUrl: z.string().url().optional().describe('Base URL of the Elasticsearch instance. Defaults to ELASTIC_URL from .env'),
  inferenceId: z.string().optional().describe('ID for the inference endpoint. Defaults to INFERENCE_ID from .env'),
  elasticApiKey: z.string().optional().describe('Elasticsearch API Key. Defaults to ELASTIC_API_KEY from .env'),
  modelId: z.string().optional().describe('Model ID for the text embedding. Defaults to MODEL_ID from .env'),
  dataFile: z.string().optional().describe('Path to the JSONL data file. Defaults to DATA_FILE from .env'),
  numAllocations: z.number().default(4).optional().describe('Number of allocations for the inference endpoint. Defaults to 4.'),
  templatesDir: z.string().optional().describe('Absolute path to the directory containing search template files (.mustache). Defaults to SEARCH_TEMPLATES_DIR from .env'),
  dashboardFilePath: z.string().optional().describe('Path to the dashboard file. Defaults to DASHBOARD_FILE_PATH from .env'),
  kibanaUrl: z.string().url().optional().describe('Base URL of the Kibana instance. Inferred from elasticUrl'),
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
      const toolInput = {
        elasticUrl: inputData.elasticUrl,
        elasticApiKey: inputData.elasticApiKey,
        indexName: inputData.indexName,
        inferenceId: inputData.inferenceId,
        templatesDir: inputData.templatesDir,
        numAllocations: inputData.numAllocations
      };
      const toolResult = await elasticsearchTeardownTool.execute({ context: toolInput, runtimeContext });
      return toolResult; // propagate only toolResult
    },
  });

const mlSetupStep = createStep({
  id: 'ml-setup',
  inputSchema: workflowOutputSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData, runtimeContext }) => {
    const toolInput = {
      elasticUrl: process.env.ELASTIC_URL,
      elasticApiKey: process.env.ELASTIC_API_KEY,
      inferenceId: process.env.INFERENCE_ID,
      modelId: process.env.MODEL_ID,
      numAllocations: 4,
    };
    const toolResult = await elasticsearchMlSetupTool.execute({ context: toolInput, runtimeContext });
    return toolResult;
  },
});

const indexSetupStep = createStep({
  id: 'index-setup',
  inputSchema: workflowOutputSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData, runtimeContext }) => {
    const toolInput = {
      elasticUrl: process.env.ELASTIC_URL,
      elasticApiKey: process.env.ELASTIC_API_KEY,
      indexName: process.env.INDEX_NAME,
    };
    const toolResult = await elasticsearchIndexSetupTool.execute({ context: toolInput, runtimeContext });
    return toolResult;
  },
});

const searchTemplateSetupStep = createStep({
  id: 'search-templates-setup',
  inputSchema: workflowOutputSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData, runtimeContext }) => {
    const toolInput = {
      elasticUrl: process.env.ELASTIC_URL,
      elasticApiKey: process.env.ELASTIC_API_KEY,
      indexName: process.env.INDEX_NAME,
      inferenceId: process.env.INFERENCE_ID,
      templatesDir: process.env.SEARCH_TEMPLATES_DIR,
    };
    const toolResult = await elasticsearchSearchTemplateSetupTool.execute({ context: toolInput, runtimeContext });
    return toolResult;
  },
});

const dataloadStep = createStep({
  id: 'dataload',
  inputSchema: workflowOutputSchema.extend({ dataFile: z.string().optional() }),
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData, runtimeContext }) => {
    const dataFileRaw = inputData.dataFile || process.env.DATA_FILE;
    const dataFile = expandEnvVars(dataFileRaw || '');
    const toolInput = {
      elasticUrl: process.env.ELASTIC_URL,
      elasticApiKey: process.env.ELASTIC_API_KEY,
      indexName: process.env.INDEX_NAME,
      dataFile,
      batchSize: 1000,
      maxRetries: 5,
      initialDelay: 1000,
      backoffFactor: 2,
    };
    const toolResult = await elasticsearchIndexDataloadTool.execute({ context: toolInput, runtimeContext });
    return toolResult;
  },
});

const dashboardSetupStep = createStep({
  id: 'dashboard-setup',
  inputSchema: workflowOutputSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData, runtimeContext }) => {
    const toolInput = {
      elasticUrl: process.env.ELASTIC_URL,
      kibanaUrl: process.env.KIBANA_URL,
      elasticApiKey: process.env.ELASTIC_API_KEY,
      dashboardFilePath: process.env.DASHBOARD_FILE_PATH || `${process.env.PROJECT_HOME || ''}/dashboards/sample_kibana_dashboard.ndjson`,
    };
    const toolResult = await elasticsearchDashboardSetupTool.execute({ context: toolInput, runtimeContext });
    return toolResult;
  },
});

const completionStep = createStep({
  id: 'workflow-completion',
  inputSchema: workflowOutputSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData }) => {
    return {
      success: inputData.success,
      message: 'Elasticsearch setup workflow completed successfully: ' + inputData.message,
      details: inputData.details,
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
  .then(dashboardSetupStep)
  .then(completionStep);

elasticsearchSetupWorkflow.commit();

export { elasticsearchSetupWorkflow };
