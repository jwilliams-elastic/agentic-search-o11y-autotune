import { Client, errors } from '@elastic/elasticsearch';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as fs from 'fs';
import * as readline from 'readline';
import { config } from 'dotenv';
import { expandEnvVars } from '../../utils/env';

config();

const inputSchema = z.object({
  elasticUrl: z.string().url().optional().describe('Base URL of the Elasticsearch instance. Defaults to ELASTIC_URL from .env'),
  elasticApiKey: z.string().optional().describe('Elasticsearch API Key. Defaults to ELASTIC_API_KEY from .env'),
  indexName: z.string().optional().describe('Name of the Elasticsearch index to load data into. Defaults to INDEX_NAME from .env'),
  dataFile: z.string().optional().describe('Path to the JSONL data file. Defaults to DATA_FILE from .env'),
  batchSize: z.number().default(1000).describe('Number of records per batch'),
  maxRetries: z.number().default(5).describe('Maximum number of retries for bulk insert'),
  initialDelay: z.number().default(10).describe('Initial delay in seconds for retries'),
  backoffFactor: z.number().default(2).describe('Factor to multiply delay by for each retry'),
});

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z.record(z.string(), z.any()).optional(),
  recordsLoaded: z.number(),
});

const loadData = async (params: z.infer<typeof inputSchema>, runtimeContext?: any): Promise<z.infer<typeof outputSchema>> => {
  // Get values from params or environment variables with defaults
  const elasticUrl = params.elasticUrl || process.env.ELASTIC_URL;
  const elasticApiKey = params.elasticApiKey || process.env.ELASTIC_API_KEY;
  const indexName = params.indexName || process.env.INDEX_NAME;
  const dataFile = params.dataFile || process.env.DATA_FILE;
  const batchSize = params.batchSize || 1000;
  const maxRetries = params.maxRetries || 5;
  const initialDelay = params.initialDelay || 10;
  const backoffFactor = params.backoffFactor || 2;
  
  // Validate required parameters
  if (!elasticUrl) {
    return { success: false, message: 'elasticUrl is required but not provided and ELASTIC_URL environment variable is not set', recordsLoaded: 0 };
  }
  if (!elasticApiKey) {
    return { success: false, message: 'elasticApiKey is required but not provided and ELASTIC_API_KEY environment variable is not set', recordsLoaded: 0 };
  }
  if (!indexName) {
    return { success: false, message: 'indexName is required but not provided and INDEX_NAME environment variable is not set', recordsLoaded: 0 };
  }
  if (!dataFile) {
    return { success: false, message: 'dataFile is required but not provided and DATA_FILE environment variable is not set', recordsLoaded: 0 };
  }
  // Debug information
  console.log(`Starting data load process with file: ${dataFile}`);
  
  // Use the absolute path directly without any resolution
  if (!fs.existsSync(dataFile as string)) {
    console.log(`Data file not found at the specified path: ${dataFile}`);
    return { success: false, message: `Error: Data file not found at ${dataFile}`, recordsLoaded: 0 };
  }
  
  console.log(`Using data file at absolute path: ${dataFile}`);

  const client = new Client({
    node: elasticUrl as string,
    auth: { apiKey: elasticApiKey as string },
  });

  
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const bulkWithRetries = async (actions: any[], batchNumber: number, totalBatches: number) => {
    let attempt = 0;
    let delay = initialDelay;
    while (attempt < maxRetries) {
      try {
        // Add trace event for retry attempt
        if (runtimeContext?.trace && attempt > 0) {
          runtimeContext.trace({
            type: 'warning',
            message: `Retry attempt ${attempt}/${maxRetries} for batch ${batchNumber}/${totalBatches}`,
            data: { attempt, maxRetries, batchNumber, totalBatches, delay: delay / 1000 }
          });
        }
        
        const response = await client.bulk({ refresh: false, operations: actions });
        if (response.errors) {
            // Log detailed error information if available
            const firstError = response.items.find(item => item.index && item.index.error);
            throw new Error(`Bulk insert failed with errors. First error: ${JSON.stringify(firstError?.index?.error)}`);
        }
        return;
      } catch (e: any) {
        attempt++;
        if (e instanceof errors.ConnectionError || e instanceof errors.ResponseError || e.message.includes('Bulk insert failed')) {
          if (attempt >= maxRetries) {
            throw e;
          }
          console.log(`⚠️  Bulk insert failed on attempt ${attempt}, retrying in ${delay / 1000}s... (${e.constructor.name}: ${e.message})`);
          await sleep(delay);
          delay *= backoffFactor;
        } else {
          // Rethrow unexpected errors
          throw e;
        }
      }
    }
  };

  let recordsLoaded = 0;
  let batch: any[] = [];
  let totalRecords = 0;
  let batchNumber = 0;
  let estimatedTotalBatches = 0;
  
  // Create initial trace event for starting data load
  if (runtimeContext?.trace) {
    runtimeContext.trace({
      type: 'info',
      message: `Starting data load from ${dataFile} into index ${indexName}`,
      data: { elasticUrl, indexName, dataFile, batchSize }
    });
  }
  
  // Count total records to estimate progress
  try {
    const countFileStream = fs.createReadStream(dataFile as string);
    const countRl = readline.createInterface({
      input: countFileStream,
      crlfDelay: Infinity
    });
    
    for await (const line of countRl) {
      if (line.trim() !== '') {
        totalRecords++;
      }
    }
    
    estimatedTotalBatches = Math.ceil(totalRecords / batchSize);
    
    if (runtimeContext?.trace) {
      runtimeContext.trace({
        type: 'info',
        message: `Found ${totalRecords} records in file, estimated ${estimatedTotalBatches} batches`,
        data: { totalRecords, estimatedTotalBatches, batchSize }
      });
    }
  } catch (error) {
    console.log(`Error counting records: ${error}`);
    // Continue even if counting fails
  }
  
  const fileStream = fs.createReadStream(dataFile as string);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  try {
    console.log(`Starting to process ${totalRecords} records from ${dataFile} into index ${indexName}`);
    
    for await (const line of rl) {
      if (line.trim() === '') continue;
      const record = JSON.parse(line.trim());
      batch.push({ index: { _index: indexName } });
      batch.push(record);
      recordsLoaded++;

      if (batch.length / 2 >= batchSize) {
        batchNumber++;
        const progress = estimatedTotalBatches > 0 ? Math.round((batchNumber / estimatedTotalBatches) * 100) : 0;
        
        // Add trace event before processing batch
        if (runtimeContext?.trace) {
          runtimeContext.trace({
            type: 'info',
            message: `Processing batch ${batchNumber}/${estimatedTotalBatches} (${progress}%)`,
            data: { batchNumber, totalBatches: estimatedTotalBatches, recordsInBatch: batch.length / 2, totalRecordsProcessed: recordsLoaded }
          });
        }
        
        console.log(`Processing batch ${batchNumber}/${estimatedTotalBatches} (${progress}%) - ${batch.length / 2} records`);
        await bulkWithRetries(batch, batchNumber, estimatedTotalBatches);
        console.log(`Successfully indexed batch ${batchNumber}/${estimatedTotalBatches} - ${batch.length / 2} records (${recordsLoaded} total)`);
        
        // Add trace event after processing batch
        if (runtimeContext?.trace) {
          runtimeContext.trace({
            type: 'success',
            message: `Successfully indexed batch ${batchNumber}/${estimatedTotalBatches}`,
            data: { batchNumber, totalBatches: estimatedTotalBatches, recordsInBatch: batch.length / 2, totalRecordsProcessed: recordsLoaded }
          });
        }
        
        batch = [];
      }
    }

    // Close the readline interface to prevent hanging
    rl.close();
    fileStream.close();

    if (batch.length > 0) {
      batchNumber++;
      
      // Add trace event before processing final batch
      if (runtimeContext?.trace) {
        runtimeContext.trace({
          type: 'info',
          message: `Processing final batch ${batchNumber}/${estimatedTotalBatches}`,
          data: { batchNumber, totalBatches: estimatedTotalBatches, recordsInBatch: batch.length / 2, totalRecordsProcessed: recordsLoaded }
        });
      }
      
      console.log(`Processing final batch ${batchNumber}/${estimatedTotalBatches} - ${batch.length / 2} records`);
      await bulkWithRetries(batch, batchNumber, estimatedTotalBatches);
      console.log(`Successfully indexed final batch ${batchNumber}/${estimatedTotalBatches} - ${batch.length / 2} records (${recordsLoaded} total)`);
      
      // Add trace event after processing final batch
      if (runtimeContext?.trace) {
        runtimeContext.trace({
          type: 'success',
          message: `Successfully indexed final batch ${batchNumber}/${estimatedTotalBatches}`,
          data: { batchNumber, totalBatches: estimatedTotalBatches, recordsInBatch: batch.length / 2, totalRecordsProcessed: recordsLoaded }
        });
      }
    }

    // Add completion trace event
    const completionMessage = `Successfully loaded ${recordsLoaded} records into '${indexName}'`;
    console.log(completionMessage);
    
    if (runtimeContext?.trace) {
      runtimeContext.trace({
        type: 'success',
        message: completionMessage,
        data: { totalRecords: recordsLoaded, indexName }
      });
    }
    
    return { success: true, message: completionMessage, recordsLoaded };

  } catch (error: any) {
    // Make sure to close streams in case of error
    try {
      rl.close();
      fileStream.close();
    } catch (closeError) {
      console.error('Error while closing file streams:', closeError);
    }
    
    // Add error trace event
    const errorMessage = `Error loading data: ${error.message}`;
    console.error(errorMessage);
    
    if (runtimeContext?.trace) {
      runtimeContext.trace({
        type: 'error',
        message: errorMessage,
        data: { error: error.message, recordsLoaded }
      });
    }
    
    return { success: false, message: `An error occurred: ${error.message}`, recordsLoaded };
  }
};

export const elasticsearchIndexDataloadTool = createTool({
  id: 'load-data-into-elasticsearch',
  description: 'Loads data from a JSONL file into an Elasticsearch index in batches with retries.',
  inputSchema,
  outputSchema,
  execute: async ({ context, runtimeContext }) => {
    return await loadData(context, runtimeContext);
  },
});
