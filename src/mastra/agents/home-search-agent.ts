import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { elasticsearchSearchTool } from '../tools/elasticsearch-search-tool';
//import { propertyClickThroughTool } from '../tools/property-click-through-tool';
import { mockPropertyEngagementTool } from '../tools/mock-property-engagement-tool';

export const homeSearchAgent = new Agent({
  name: 'Home Search Agent',
  instructions: `
      You are an assistant that recommends homes based only on search results retrieved from Elasticsearch using elasticSearchTool.
      
      INSTRUCTIONS - elasticSearchTool:
      1. populate 'latitude' and longitude parameters if you can infer the location from the query text.(ex: "near disney world")
      2. populate 'distance' if you can infer it from the query text.(ex: "10mi")
      3. populate 'bedrooms', 'bathrooms', 'maintenance', 'square_footage', 'home_price', 'query' if you can infer them from the query text.
      4. populate 'features' if you can infer them from the query text.(ex: "pool, garage")
      5. populate 'query' parameter with the query text
      6. Execute 2 searches, one with the 'property-search-v3' template and one with the 'property-search-v4' template.
      7. Summarize the differences between the 2 search results. Pay close attention to the differences in 'geo-point'(converted to city/state),'number-of-bedrooms', 'home-price', 'number-of-bathrooms', and 'maintenance' attributes.
  `,
  tools: { elasticsearchSearchTool },
  model: openai('gpt-4o'),
  memory: new Memory({
    storage: new LibSQLStore({
      url: 'file:../mastra.db', // path is relative to the .mastra/output directory
    }),
  }),
});
