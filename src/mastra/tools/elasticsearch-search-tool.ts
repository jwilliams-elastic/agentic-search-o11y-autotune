import { Client } from '@elastic/elasticsearch';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { fileLogger, logger } from '../logger-agentless';
import { config } from 'dotenv';

// Auto-training thresholds - easily configurable
const MIN_SEARCH_EVENTS = 15;   // Minimum search events before triggering auto-training
const MIN_INTERACTION_EVENTS = 8; // Minimum interaction events before triggering auto-training


config();

const inputSchema = z.object({

  userId: z.string().describe('ID of the user performing the search'),
  searchTemplateId: z.string().default('properties-search-adaptive-ltr').describe('ID for the search template to use. Options: properties-search-adaptive-ltr (RECOMMENDED), properties-search-rrf-v1, properties-search-linear-v1'),
  distance: z.string().optional().describe('Distance for geo search (e.g. "10km")'),
  latitude: z.string().refine(val => !isNaN(parseFloat(val)), { message: 'Latitude must be a valid float' }).optional().describe('Latitude for geo search (as string, will be converted to float)'),
  longitude: z.string().refine(val => !isNaN(parseFloat(val)), { message: 'Longitude must be a valid float' }).optional().describe('Longitude for geo search (as string, will be converted to float)'),
  bedrooms: z.number().optional().default(1).describe('Minimum number of bedrooms'),
  bathrooms: z.number().optional().default(1).describe('Minimum number of bathrooms'),
  maintenance: z.number().optional().describe('Maximum maintenance fee'),
  square_footage: z.number().optional().describe('Minimum square footage'),
  home_price: z.number().optional().describe('Maximum home price'),
  query: z.string().optional().describe('Semantic search query for property description and features'),
  features: z.string().optional().describe('Specific property features to search for'),
  enableLTR: z.boolean().default(true).describe('Enable LTR reranking'),
  ltrModelName: z.string().optional().default('home_search_ltr_model').describe('Name of the LTR model to use for rescoring'),
  logInteractions: z.boolean().default(true).describe('Log search interactions for LTR training'),
  // ...existing code...
});

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  results: z.array(z.record(z.string(), z.any())).optional(),
  total: z.number().optional(),
  sessionId: z.string().optional(),
  ltrEnabled: z.boolean().optional(),
  searchTimeMs: z.number().optional(),
  details: z.record(z.string(), z.any()).optional(),
});

const searchProperties = async (params: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> => {
  const startTime = Date.now();
  const sessionId = `search_session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  // ...existing code...
  
  // Get values from params or environment variables
  const elasticUrl = process.env.ELASTIC_URL;
  const elasticApiKey = process.env.ELASTIC_API_KEY;
  const searchTemplateId = params.searchTemplateId;
  
  // Validate required parameters
  if (!elasticUrl) {
    return { success: false, message: 'elasticUrl is required but not provided and ELASTIC_URL environment variable is not set' };
  }
  if (!elasticApiKey) {
    return { success: false, message: 'elasticApiKey is required but not provided and ELASTIC_API_KEY environment variable is not set' };
  }
  
  // Create Elasticsearch client
  const client = new Client({
    node: elasticUrl,
    auth: { apiKey: elasticApiKey },
  });
  
  // Check if LTR model is available for adaptive template usage
  const checkLTRModelAvailable = async (modelName: string): Promise<boolean> => {
    try {
      await client.ml.getTrainedModels({ model_id: modelName });
      return true;
    } catch (error) {
      console.log(`ℹ️  LTR model '${modelName}' not available, using baseline search`);
      return false;
    }
  };
  
  try {
    // Build the template parameters based on provided inputs
    const templateParams: Record<string, any> = {};
    
    // Add parameters to the template only if they are provided
    if (params.distance && params.latitude && params.longitude) {
      templateParams.distance = params.distance;
      // Convert string latitude and longitude to floats
      templateParams.latitude = parseFloat(params.latitude);
      templateParams.longitude = parseFloat(params.longitude);
    }
    
    if (params.bedrooms) templateParams.bedrooms = params.bedrooms;
    if (params.bathrooms) templateParams.bathrooms = params.bathrooms;
    if (params.maintenance) templateParams.maintenance = params.maintenance;
    if (params.square_footage) templateParams.square_footage = params.square_footage;
    if (params.home_price) templateParams.home_price = params.home_price;
    if (params.query) templateParams.query = params.query;
    if (params.features) templateParams.features = params.features;
    
    // Check for adaptive LTR template usage
    const ltrModelName = params.ltrModelName || 'home_search_ltr_model';
    const isAdaptiveTemplate = searchTemplateId === 'properties-search-adaptive-ltr';
    
    if (isAdaptiveTemplate && params.enableLTR) {
      // For adaptive template, check model availability and set parameters
      const modelAvailable = await checkLTRModelAvailable(ltrModelName);
      templateParams.ltr_model_available = modelAvailable;
      templateParams.ltr_model_name = ltrModelName;
    }

    // Execute search using the search template
    const searchRequest: any = {
      index: process.env.INDEX_NAME,
      id: searchTemplateId,
      params: templateParams,
    };
    
    const searchResponse = await client.searchTemplate(searchRequest);

    // Extract and format results
    const hits = searchResponse.hits.hits;
    const total = searchResponse.hits.total as { value: number };
    const searchTimeMs = Date.now() - startTime;

    // Log search session with unified logger
    if (params.logInteractions) {
      logger.info({
        '@timestamp': new Date().toISOString(),
        'event.action': 'agent_search',
        'event.category': ['web'],
        'event.outcome': 'success',
        'user.id': params.userId,
        'search.session_id': sessionId,
        'search.query': params.query || 'filtered_search',
        'search.results_count': total.value,
        'search.template_id': searchTemplateId,
        'search.ltr_enabled': params.enableLTR,
        'performance.search_time_ms': searchTimeMs,
        'performance.elasticsearch_time_ms': searchResponse.took,
        'service': {
          name: 'elasticsearch-search-tool'
        }
      });
    }

    if (hits.length === 0) {
      return { 
        success: true, 
        message: 'No properties found matching the search criteria.',
        results: [],
        total: 0,
        sessionId,
        ltrEnabled: params.enableLTR,
        searchTimeMs
      };
    }

    // Format the results with position tracking
    const formattedResults = hits.map((hit, index) => {
      return {
        id: hit._id,
        score: hit._score,
        position: index + 1, // 1-based position indexing
        ...hit.fields
      };
    });
    
    // Log individual search results with document IDs for LTR training
    if (params.logInteractions && formattedResults.length > 0) {
      for (const result of formattedResults) {
        logger.info({
          '@timestamp': new Date().toISOString(),
          'event.action': 'search_result_logged',
          'event.category': ['search'],
          'event.outcome': 'success',
          'user.id': params.userId,
          'search.session_id': sessionId,
          'search.result': {
            document_id: result.id,
            position: result.position,
            elasticsearch_score: result.score,
            query: params.query || 'filtered_search'
          },
          'search.context': {
            total_results: total.value,
            template_id: searchTemplateId,
            ltr_enabled: params.enableLTR
          },
          'service': {
            name: 'elasticsearch-search-tool'
          }
        });
      }
    }
    
    return {
      success: true,
      message: `Found ${total.value} properties matching the search criteria.`,
      results: formattedResults,
      total: total.value,
      sessionId,
      ltrEnabled: params.enableLTR,
      searchTimeMs,
      details: {
        took: searchResponse.took,
        timed_out: searchResponse.timed_out,
        ltr_model_used: params.enableLTR ? 'home_search_ltr_model' : null
      }
    };
  } catch (error: any) {
    return { 
      success: false, 
      message: `Error executing search: ${error?.meta?.statusCode || error.statusCode || 'unknown'}, ${error?.meta?.body?.error?.reason || error.message}`,
      details: error?.meta?.body?.error || error
    };
  }
};

export const elasticsearchSearchTool = createTool({
  id: 'elasticsearch-search-tool',
  description: 'Advanced search for properties using Elasticsearch with LTR reranking, conversational detection, position-aware logging, and comprehensive observability features. Includes native Elasticsearch LTR integration and James\'s unified logger.',
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    return await searchProperties(context);
  },
});
