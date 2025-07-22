import { Client } from '@elastic/elasticsearch';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { config } from 'dotenv';

config();

const inputSchema = z.object({

  userId: z.string().describe('ID of the user performing the search'),
  searchTemplateId: z.string().default('properties-search-linear-v1').describe('ID for the search template to use. Other options are: properties-search-linear-v2 and properties-search-rrf-v1'),
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
});

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  results: z.array(z.record(z.string(), z.any())).optional(),
  total: z.number().optional(),
  details: z.record(z.string(), z.any()).optional(),
});

const searchProperties = async (params: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> => {
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
    const searchResponse = await client.searchTemplate({
      index: process.env.INDEX_NAME,
      id: searchTemplateId,
      params: templateParams,
    });

    // Extract and format results
    const hits = searchResponse.hits.hits;
    const total = searchResponse.hits.total as { value: number };

    console.log({ event: { type: 'SEARCH', params: params, total: total.value } });

    if (hits.length === 0) {
      return { 
        success: true, 
        message: 'No properties found matching the search criteria.',
        results: [],
        total: 0
      };
    }

    // Format the results
    const formattedResults = hits.map(hit => {
      return {
        id: hit._id,
        score: hit._score,
        ...hit.fields
      };
    });

    return {
      success: true,
      message: `Found ${total.value} properties matching the search criteria.`,
      results: formattedResults,
      total: total.value,
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
  description: 'Search for properties using Elasticsearch with customizable filters including location, bedrooms, bathrooms, price, and features.',
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    return await searchProperties(context);
  },
});
