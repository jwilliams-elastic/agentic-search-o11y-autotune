import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { elasticsearchSearchTool } from '../tools/elasticsearch-search-tool';
import { elasticsearchSearchLTRTool } from '../tools/elasticsearch-search-ltr-tool';
import { propertyClickThroughTool } from '../tools/property-click-through-tool';

export const homeSearchAgent = new Agent({
  name: 'Home Search Agent',
  instructions: `
      You are an assistant that recommends homes based only on search results retrieved from Elasticsearch using elasticSearchTool.
     
      1. populate 'latitude' and longitude parameters if you can infer the location from the query text.(ex: "near disney world")
      2. populate 'distance' if you can infer it from the query text.(ex: "10mi")
      3. populate 'bedrooms', 'bathrooms', 'maintenance', 'square_footage', 'home_price', 'query' if you can infer them from the query text.
      4. populate 'features' if you can infer them from the query text.(ex: "pool, garage")
      5. populate 'query' parameter with the query text
      6. return the results from the elasticSearchTool
      7. when a user clicks on a property listing, use the propertyClickThroughTool to log the click-through event with the userId and propertyId
      8. Use elasticsearchSearchLTRTool for intelligent reranking when you need enhanced relevance
      9. Detect conversational references like "tell me about the first property" or "show me property 2" and log position-aware interactions
  `,
  model: openai('gpt-4o'),
  tools: { elasticsearchSearchTool, elasticsearchSearchLTRTool, propertyClickThroughTool },
  memory: new Memory({
    storage: new LibSQLStore({
      url: 'file:../mastra.db', // path is relative to the .mastra/output directory
    }),
  }),
});
