import { Client } from '@elastic/elasticsearch';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { fileLogger, logger } from '../logger-agentless';
import { config } from 'dotenv';

// Auto-training thresholds - easily configurable
const MIN_SEARCH_EVENTS = 15;   // Minimum search events before triggering auto-training
const MIN_INTERACTION_EVENTS = 8; // Minimum interaction events before triggering auto-training

// Conversational pattern detection
const POSITION_PATTERNS = [
  { pattern: /\b(?:first|1st)\b/i, position: 1 },
  { pattern: /\b(?:second|2nd)\b/i, position: 2 },
  { pattern: /\b(?:third|3rd)\b/i, position: 3 },
  { pattern: /\b(?:fourth|4th)\b/i, position: 4 },
  { pattern: /\b(?:fifth|5th)\b/i, position: 5 },
  { pattern: /\bproperty\s+(\d+)\b/i, position: 'match' },
  { pattern: /\boption\s+(\d+)\b/i, position: 'match' },
  { pattern: /\bresult\s+(\d+)\b/i, position: 'match' },
  { pattern: /\bnumber\s+(\d+)\b/i, position: 'match' }
];

// Detect conversational references to search results
/**
 * Calculate confidence score for conversational detection based on pattern matching
 * @param message - The user's message
 * @param position - The detected position (1-based)
 * @returns confidence score between 0.5 and 1.0
 */
function calculateConfidenceScore(message: string, position: number | null): number {
  if (!position) return 0.5;
  
  let confidence = 0.6; // Base confidence
  
  // Boost confidence for explicit position references
  if (/\b(first|1st)\b/i.test(message)) confidence += 0.25;
  if (/\b(second|2nd)\b/i.test(message)) confidence += 0.25;
  if (/\b(third|3rd)\b/i.test(message)) confidence += 0.25;
  if (/\b(property|listing|home|house)\s*#?\s*\d+/i.test(message)) confidence += 0.3;
  
  // Boost confidence for definitive language
  if (/\b(tell me about|show me|more info|details about)\b/i.test(message)) confidence += 0.15;
  if (/\b(that one|this one|the one)\b/i.test(message)) confidence += 0.1;
  
  // Boost confidence for direct references
  if (/\btop\s*(result|property|listing)/i.test(message)) confidence += 0.2;
  if (/\babove\b/i.test(message)) confidence += 0.15;
  
  // Reduce confidence for vague language
  if (/\b(maybe|might|could|perhaps)\b/i.test(message)) confidence -= 0.1;
  if (/\b(or|either|any)\b/i.test(message)) confidence -= 0.05;
  
  // Ensure confidence stays within bounds
  return Math.max(0.5, Math.min(1.0, confidence));
}

function detectConversationalInteraction(message: string, userId: string, sessionId: string, lastSearchResults: any[] = []) {
  let detectedPosition: number | null = null;
  
  // Check position patterns
  for (const pattern of POSITION_PATTERNS) {
    const match = message.match(pattern.pattern);
    if (match) {
      if (pattern.position === 'match' && match[1]) {
        detectedPosition = parseInt(match[1]);
      } else if (typeof pattern.position === 'number') {
        detectedPosition = pattern.position;
      }
      break;
    }
  }
  
  // If no specific position detected, check for general interest indicators
  if (!detectedPosition && (
    /\b(?:this|that|it)\b/i.test(message) ||
    /\b(?:more|details)\b/i.test(message)
  )) {
    detectedPosition = 1; // Assume referring to top result
  }
  
  // Log conversational interaction if detected
  if (detectedPosition && lastSearchResults.length >= detectedPosition) {
    const targetResult = lastSearchResults.find((r: any) => r.position === detectedPosition);
    
    if (targetResult) {
      logger.info({
        '@timestamp': new Date().toISOString(),
        'event.action': 'agent_user_interactions',
        'event.category': ['user'],
        'event.outcome': 'success',
        'user.id': userId,
        'search.session_id': sessionId,
        'search.interaction': {
          document_id: targetResult.id,
          position: detectedPosition,
          type: 'conversational_click',
          trigger: 'natural_language_detection',
          original_message: message,
          detected_pattern: 'conversational_reference'
        },
        'agent': {
          conversational_detection: true,
          confidence_score: calculateConfidenceScore(message, detectedPosition)
        },
        'service': {
          name: 'elasticsearch-search-tool'
        }
      });
      
      return {
        detected: true,
        position: detectedPosition,
        document_id: targetResult.id,
        type: 'conversational_click'
      };
    }
  }
  
  return { detected: false };
}

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
  userMessage: z.string().optional().describe('User message to analyze for conversational references'),
  lastSearchResults: z.array(z.object({
    id: z.string(),
    title: z.string(),
    position: z.number()
  })).optional().describe('Previous search results for conversational detection'),
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
  
  // Check for conversational interactions first
  if (params.userMessage && params.lastSearchResults) {
    const conversationalResult = detectConversationalInteraction(
      params.userMessage,
      params.userId,
      sessionId,
      params.lastSearchResults
    );
    
    if (conversationalResult.detected) {
      console.log(`🎧 Detected conversational interaction: position ${conversationalResult.position}`);
    }
  }
  
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
