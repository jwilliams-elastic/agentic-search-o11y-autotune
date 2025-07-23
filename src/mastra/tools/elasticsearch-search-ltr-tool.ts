import { Client } from '@elastic/elasticsearch';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { config } from 'dotenv';
import { fileLogger } from '../logger-agentless';

config();

const inputSchema = z.object({
  userId: z.string().describe('ID of the user performing the search'),
  searchTemplateId: z.string().default('properties-search-template-v1').describe('ID for the search template to use'),
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
  logInteractions: z.boolean().default(true).describe('Log search interactions for LTR training'),
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

interface SearchResult {
  id: string;
  _score: number;
  position: number;
  title: string;
  content: string;
  price?: number;
  category?: string;
  features?: Record<string, any>;
  ltr_score?: number;
}

interface SearchSession {
  session_id: string;
  user_id: string;
  query: string;
  timestamp: string;
  results: SearchResult[];
  total_results: number;
  search_time_ms: number;
  result_count: number;
  avg_position_score: number;
  position_distribution: Record<string, number>;
  query_length: number;
  query_word_count: number;
  query_type: string;
}

const searchPropertiesWithLTR = async (params: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> => {
  const startTime = Date.now();
  
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

  // Generate session ID
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    // Build search template parameters
    const templateParams: Record<string, any> = {
      bedrooms: params.bedrooms,
      bathrooms: params.bathrooms,
    };

    // Add optional parameters
    if (params.maintenance !== undefined) templateParams.maintenance = params.maintenance;
    if (params.square_footage !== undefined) templateParams.square_footage = params.square_footage;
    if (params.home_price !== undefined) templateParams.home_price = params.home_price;
    if (params.query !== undefined) templateParams.query = params.query;
    if (params.features !== undefined) templateParams.features = params.features;
    
    // Add geo search parameters
    if (params.latitude && params.longitude) {
      templateParams.latitude = parseFloat(params.latitude);
      templateParams.longitude = parseFloat(params.longitude);
      templateParams.distance = params.distance || '10km';
    }

    // Execute search
    const searchResponse = await client.searchTemplate({
      index: 'properties',
      body: {
        id: searchTemplateId,
        params: templateParams,
      },
    });

    const searchTimeMs = Date.now() - startTime;
    const hits = searchResponse.body.hits.hits;
    const totalHits = searchResponse.body.hits.total.value;

    // Process search results with position information
    const processedResults: SearchResult[] = hits.map((hit: any, index: number) => {
      const source = hit._source;
      return {
        id: hit._id,
        _score: hit._score,
        position: index + 1,
        title: source.title || source.property_name || 'Unknown Property',
        content: source.description || source.features || '',
        price: source.price || source.home_price,
        category: source.property_type || 'residential',
        features: {
          bedrooms: source.bedrooms,
          bathrooms: source.bathrooms,
          square_footage: source.square_footage,
          maintenance: source.maintenance,
          address: source.address,
          location: source.location,
        },
        ...source,
      };
    });

    // Apply LTR reranking if enabled
    let ltrResults = processedResults;
    if (params.enableLTR && processedResults.length > 0) {
      try {
        ltrResults = await applyLTRReranking(processedResults, params.query || '', {
          total_results: totalHits,
          search_time_ms: searchTimeMs,
          user_id: params.userId,
        });
      } catch (ltrError) {
        console.warn('LTR reranking failed, using baseline results:', ltrError);
      }
    }

    // Log search session for LTR training
    if (params.logInteractions) {
      await logSearchSession({
        session_id: sessionId,
        user_id: params.userId,
        query: params.query || 'filtered_search',
        timestamp: new Date().toISOString(),
        results: ltrResults,
        total_results: totalHits,
        search_time_ms: searchTimeMs,
        result_count: ltrResults.length,
        avg_position_score: calculateAveragePositionScore(ltrResults),
        position_distribution: calculatePositionDistribution(ltrResults),
        query_length: (params.query || '').length,
        query_word_count: (params.query || '').split(' ').length,
        query_type: classifyQueryType(params),
      });
    }

    // Enhanced ECS logging with position information
    const ecsLog = {
      '@timestamp': new Date().toISOString(),
      'event.kind': 'event',
      'event.category': ['web'],
      'event.type': ['access'],
      'event.action': 'search_with_ltr',
      'event.outcome': 'success',
      'user.id': params.userId,
      'search.query': params.query || 'filtered_search',
      'search.results.total': totalHits,
      'search.results.returned': ltrResults.length,
      'search.duration_ms': searchTimeMs,
      'search.session_id': sessionId,
      'search.ltr_enabled': params.enableLTR,
      'search.template_id': searchTemplateId,
      'search.position_analytics': {
        avg_position_score: calculateAveragePositionScore(ltrResults),
        position_distribution: calculatePositionDistribution(ltrResults),
        top_3_results: ltrResults.slice(0, 3).map(r => ({
          position: r.position,
          score: r._score,
          ltr_score: r.ltr_score,
          title: r.title,
        })),
      },
      'search.parameters': {
        bedrooms: params.bedrooms,
        bathrooms: params.bathrooms,
        maintenance: params.maintenance,
        square_footage: params.square_footage,
        home_price: params.home_price,
        features: params.features,
        geo_enabled: !!(params.latitude && params.longitude),
        distance: params.distance,
      },
      'http.response.status_code': 200,
      'labels': {
        service: 'elasticsearch-search-ltr',
        environment: process.env.NODE_ENV || 'development',
      },
    };

    // Log to file
    fileLogger.info(ecsLog);

    return {
      success: true,
      message: `Found ${totalHits} properties matching your criteria`,
      results: ltrResults,
      total: totalHits,
      sessionId: sessionId,
      ltrEnabled: params.enableLTR,
      searchTimeMs: searchTimeMs,
      details: {
        searchTemplate: searchTemplateId,
        templateParams,
        avgPositionScore: calculateAveragePositionScore(ltrResults),
        positionDistribution: calculatePositionDistribution(ltrResults),
      },
    };

  } catch (error) {
    const searchTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    // Error logging with position context
    const errorLog = {
      '@timestamp': new Date().toISOString(),
      'event.kind': 'event',
      'event.category': ['web'],
      'event.type': ['error'],
      'event.action': 'search_with_ltr',
      'event.outcome': 'failure',
      'user.id': params.userId,
      'search.query': params.query || 'filtered_search',
      'search.duration_ms': searchTimeMs,
      'search.session_id': sessionId,
      'search.ltr_enabled': params.enableLTR,
      'error.message': errorMessage,
      'error.type': error?.constructor.name || 'UnknownError',
      'http.response.status_code': 500,
      'labels': {
        service: 'elasticsearch-search-ltr',
        environment: process.env.NODE_ENV || 'development',
      },
    };

    fileLogger.error(errorLog);

    return {
      success: false,
      message: `Search failed: ${errorMessage}`,
      sessionId: sessionId,
      ltrEnabled: params.enableLTR,
      searchTimeMs: searchTimeMs,
    };
  }
};

// Helper functions
function calculateAveragePositionScore(results: SearchResult[]): number {
  if (results.length === 0) return 0;
  const totalScore = results.reduce((sum, result) => sum + result._score, 0);
  return totalScore / results.length;
}

function calculatePositionDistribution(results: SearchResult[]): Record<string, number> {
  return {
    top_3: Math.min(3, results.length),
    top_5: Math.min(5, results.length),
    top_10: Math.min(10, results.length),
    total: results.length,
  };
}

function classifyQueryType(params: z.infer<typeof inputSchema>): string {
  if (params.latitude && params.longitude) return 'geo';
  if (params.bedrooms || params.bathrooms || params.maintenance || params.square_footage || params.home_price) {
    return 'filtered';
  }
  if (params.query && params.query.split(' ').length > 5) return 'complex';
  return 'simple';
}

async function applyLTRReranking(
  results: SearchResult[],
  query: string,
  sessionFeatures: Record<string, any>
): Promise<SearchResult[]> {
  try {
    // Import LTR reranker service
    const { ltrRerankerService } = await import('../../../integrate-ltr-reranker.js');
    
    // Initialize the service if needed
    if (!ltrRerankerService.isReady()) {
      console.log('🔄 Initializing LTR reranker service...');
      await ltrRerankerService.initialize();
    }
    
    // Apply LTR reranking if service is ready
    if (ltrRerankerService.isReady()) {
      console.log(`🎯 Applying LTR reranking to ${results.length} results`);
      const rerankedResults = await ltrRerankerService.rerank(results, query, sessionFeatures);
      fileLogger.info(`📊 LTR Search completed: ${results.length} results, ${rerankedResults.length} reranked`);
      return rerankedResults;
    } else {
      console.log('⚠️ LTR service not ready, using fallback reranking');
      return applyFallbackReranking(results, query);
    }
    
  } catch (error) {
    console.warn('❌ LTR reranking failed, using fallback:', error.message);
    return applyFallbackReranking(results, query);
  }
}

// Fallback reranking when LTR service is unavailable
function applyFallbackReranking(
  results: SearchResult[],
  query: string
): SearchResult[] {
  const rerankedResults = results.map((result, index) => {
    // Simulate LTR score based on multiple factors
    const positionBias = 1.0 / Math.log2(result.position + 1);
    const textRelevance = calculateTextRelevance(query, result.title + ' ' + result.content);
    const priceNormalization = result.price ? Math.min(1.0, 1000000 / result.price) : 0.5;
    
    const ltrScore = (
      result._score * 0.4 +
      textRelevance * 0.3 +
      positionBias * 0.2 +
      priceNormalization * 0.1
    );
    
    return {
      ...result,
      ltr_score: ltrScore,
      ltr_fallback: true
    };
  });
  
  // Sort by LTR score
  return rerankedResults.sort((a, b) => (b.ltr_score || 0) - (a.ltr_score || 0));
}

function calculateTextRelevance(query: string, text: string): number {
  if (!query || !text) return 0;
  
  const queryWords = query.toLowerCase().split(' ');
  const textWords = text.toLowerCase().split(' ');
  
  const matches = queryWords.filter(word => textWords.includes(word));
  return matches.length / queryWords.length;
}

async function logSearchSession(session: SearchSession): Promise<void> {
  try {
    const elasticUrl = process.env.ELASTIC_URL;
    const elasticApiKey = process.env.ELASTIC_API_KEY;
    
    if (!elasticUrl || !elasticApiKey) {
      console.warn('Elasticsearch credentials not available for session logging');
      return;
    }
    
    const client = new Client({
      node: elasticUrl,
      auth: { apiKey: elasticApiKey },
    });
    
    // Index search session for LTR training
    await client.index({
      index: 'search_sessions',
      body: session,
    });
    
    console.log(`Logged search session: ${session.session_id}`);
  } catch (error) {
    console.error('Error logging search session:', error);
  }
}

// Enhanced tool with LTR capabilities
export const elasticsearchSearchLTRTool = createTool({
  id: 'elasticsearch-search-ltr-tool',
  description: 'Advanced search for properties using Elasticsearch with LTR reranking, position-aware logging, and comprehensive observability features. Includes real-time learning from user interactions.',
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    return await searchPropertiesWithLTR(context as any);
  },
});

// User interaction logging tool
export const logUserInteractionTool = createTool({
  id: 'log-user-interaction-tool',
  description: 'Log user interactions with search results for LTR training',
  inputSchema: z.object({
    sessionId: z.string().describe('Search session identifier'),
    userId: z.string().describe('User identifier'),
    documentId: z.string().describe('Document that was interacted with'),
    position: z.number().describe('Position of document in search results'),
    interactionType: z.enum(['click', 'view', 'bookmark', 'share']).describe('Type of interaction'),
    dwellTimeMs: z.number().optional().describe('Time spent on document in milliseconds'),
    scrollDepth: z.number().optional().describe('How far user scrolled (0.0 to 1.0)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    const params = context as any;
    
    try {
      const elasticUrl = process.env.ELASTIC_URL;
      const elasticApiKey = process.env.ELASTIC_API_KEY;
      
      if (!elasticUrl || !elasticApiKey) {
        return { success: false, message: 'Elasticsearch credentials not available' };
      }
      
      const client = new Client({
        node: elasticUrl,
        auth: { apiKey: elasticApiKey },
      });
      
      const interaction = {
        session_id: params.sessionId,
        user_id: params.userId,
        document_id: params.documentId,
        position: params.position,
        interaction_type: params.interactionType,
        timestamp: new Date().toISOString(),
        dwell_time_ms: params.dwellTimeMs,
        scroll_depth: params.scrollDepth,
      };
      
      await client.index({
        index: 'user_interactions',
        body: interaction,
      });
      
      // Enhanced ECS logging for user interactions
      const ecsLog = {
        '@timestamp': new Date().toISOString(),
        'event.kind': 'event',
        'event.category': ['web'],
        'event.type': ['user'],
        'event.action': 'user_interaction',
        'event.outcome': 'success',
        'user.id': params.userId,
        'search.session_id': params.sessionId,
        'search.interaction': {
          document_id: params.documentId,
          position: params.position,
          type: params.interactionType,
          dwell_time_ms: params.dwellTimeMs,
          scroll_depth: params.scrollDepth,
        },
        'labels': {
          service: 'user-interaction-logger',
          environment: process.env.NODE_ENV || 'development',
        },
      };
      
      writeToLogFile('info', ecsLog);
      
      return {
        success: true,
        message: `Logged ${params.interactionType} interaction at position ${params.position}`,
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      const errorLog = {
        '@timestamp': new Date().toISOString(),
        'event.kind': 'event',
        'event.category': ['web'],
        'event.type': ['error'],
        'event.action': 'user_interaction',
        'event.outcome': 'failure',
        'user.id': params.userId,
        'search.session_id': params.sessionId,
        'error.message': errorMessage,
        'labels': {
          service: 'user-interaction-logger',
          environment: process.env.NODE_ENV || 'development',
        },
      };
      
      writeToLogFile('error', errorLog);
      
      return {
        success: false,
        message: `Failed to log interaction: ${errorMessage}`,
      };
    }
  },
});
