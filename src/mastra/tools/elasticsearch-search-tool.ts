import { Client } from '@elastic/elasticsearch';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { fileLogger, logger } from '../logger-agentless';
import { config } from 'dotenv';

config();

const inputSchema = z.object({
  userId: z.string().describe('ID of the user performing the search'),
  sessionId: z.string().optional().describe('Search session ID for tracking interactions across tools'),
  searchTemplateId: z.string().default('properties-search-v3').describe('ID for the search template to use. Options: properties-search-v1, properties-search-v2, properties-search-v3 (RECOMMENDED), properties-search-v4'),
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
  logInteractions: z.boolean().default(true).describe('Log search interactions for LTR training')
});

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  results: z.array(z.record(z.string(), z.any())).optional(),
  total: z.number().optional(),
  sessionId: z.string().optional(),
  searchTimeMs: z.number().optional(),
  details: z.record(z.string(), z.any()).optional(),
});

const searchProperties = async (params: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> => {
  const startTime = Date.now();
  // Use provided sessionId or generate one if not provided
  const sessionId = params.sessionId || `search_session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
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

    if (hits.length === 0) {
      return { 
        success: true, 
        message: 'No properties found matching the search criteria.',
        results: [],
        total: 0,
        sessionId,
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
    // Enhanced with full query metadata for consolidated LTR training (no need for separate agent_search events)
    if (params.logInteractions && formattedResults.length > 0) {
      for (const result of formattedResults) {
        logger.info({
          '@timestamp': new Date().toISOString(),
          'event.action': 'search_result_logged',
          'event.type': 'search',
          'event.category': ['search'],
          'event.outcome': 'success',
          'user.id': params.userId,
          'session.id': sessionId,
          'query.text': params.query || 'filtered_search',
          'query.template_id': searchTemplateId,
          'query.result_count': total.value,
          'query.filters': {
            bedrooms: params.bedrooms,
            bathrooms: params.bathrooms,
            maintenance: params.maintenance,
            square_footage: params.square_footage,
            home_price: params.home_price,
            geo: params.latitude && params.longitude && params.distance ? {
              latitude: params.latitude ? parseFloat(params.latitude) : undefined,
              longitude: params.longitude ? parseFloat(params.longitude) : undefined,
              distance: params.distance
            } : undefined,
            features: params.features
          },
          'result': {
            document_id: result.id,
            position: result.position,
            elasticsearch_score: result.score
          },
          'performance': {
            search_time_ms: searchTimeMs,
            elasticsearch_time_ms: searchResponse.took
          },
          'service.name': 'elasticsearch-search-tool'
        });
      }
    }
    
    return {
      success: true,
      message: `Found ${total.value} properties matching the search criteria.`,
      results: formattedResults,
      total: total.value,
      sessionId,
      searchTimeMs,
      details: {
        took: searchResponse.took,
        timed_out: searchResponse.timed_out
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
  description: 'Advanced search for properties using Elasticsearch with LTR reranking and observability features. Includes native Elasticsearch LTR integration and unified logger.',
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    return await searchProperties(context);
  },
});
