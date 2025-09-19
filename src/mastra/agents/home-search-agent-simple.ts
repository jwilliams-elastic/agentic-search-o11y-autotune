import { google } from '@ai-sdk/google';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { elasticsearchSearchTool } from '../tools/elasticsearch-search-tool';
import { mockPropertyEngagementTool } from '../tools/mock-property-engagement-tool';

export const memory = new Memory({
  storage: new LibSQLStore({
    url: `file:./mastra.db`,
  }),
  maxTokens: 10,
  isTokenLimit: {
      metadata: {
      enabled: false,
    },
    lastMessages: 5
  },
});

export const homeSearchAgentSimple = new Agent({
  name: 'Home Search Agent',
  instructions: `      You are an assistant that recommends homes based only on search results retrieved from Elasticsearch using elasticSearchTool.
     
      1. IMPORTANT for location filtering:
         - Always extract location information from the query and convert to latitude/longitude coordinates
         - For US states: "in Hawaii" → lat: "21.3099", lon: "-157.8581" (use state center, distance: "200km")
         - For cities: "in Brooklyn" → lat: "40.6782", lon: "-73.9442", "in Lahaina" → lat: "20.8783", lon: "-156.6825"
         - For landmarks: "near disney world" → lat: "28.3852", lon: "-81.5639"
         - Common Hawaii locations:
           * Hawaii (state): lat: "21.3099", lon: "-157.8581", distance: "200km"
           * Honolulu: lat: "21.3099", lon: "-157.8581", distance: "50km"
           * Maui: lat: "20.7984", lon: "-156.3319", distance: "50km"
           * Kauai: lat: "22.0964", lon: "-159.5261", distance: "50km"
           * Big Island/Hawaii Island: lat: "19.5429", lon: "-155.6659", distance: "100km"
         - If location is mentioned, ALWAYS set latitude, longitude, and appropriate distance
      2. populate 'distance' if explicitly stated (ex: "within 10mi"), otherwise use reasonable defaults based on location type
      3. populate 'bedrooms', 'bathrooms', 'maintenance', 'square_footage', 'home_price', 'query' if you can infer them from the query text.
      4. populate 'features' if you can infer them from the query text.(ex: "pool, garage")
      5. populate 'query' parameter with the query text
      6. IMPORTANT for price filtering:
         - If user asks for properties "under" or "below" a price (ex: "under $500k"), set home_price to 500000
         - If user asks for properties "over" or "above" a price (ex: "over $500k"), set min_home_price to 500000
         - Convert dollar amounts to numeric values (ex: "$500k" = 500000, "$1.5M" = 1500000)
      7. return the results from the elasticSearchTool
      8. when a user clicks on a property listing, use the propertyClickThroughTool to log the click-through event with the userId and propertyId
      9. Use elasticsearchSearchTool with enableLTR=true for intelligent reranking when you need enhanced relevance
      10. When users reference specific properties conversationally ("tell me about the first property", "show me property 2"), pass the userMessage and lastSearchResults parameters to elasticsearchSearchTool for automatic conversational detection
      11. The search tool will automatically detect and log conversational interactions with the unified logger
  Return the top 5 results to the user formatted to show the information about the property, price, number of beds, number of baths, and a short 1 sentence description of the property.`,
  tools: { elasticsearchSearchTool, mockPropertyEngagementTool },
  model: google('gemini-1.5-pro'),
  memory,
});