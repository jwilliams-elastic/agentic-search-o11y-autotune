import { google } from '@ai-sdk/google';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { elasticsearchSearchTool } from '../tools/elasticsearch-search-tool';
 
export const memory = new Memory({
  storage: new LibSQLStore({
    url: `file:./mastra.db`,
  }),
  options: {
    semanticRecall: false,
    workingMemory: {
      enabled: false,
    },
    lastMessages: 5
  },
});

export const homeSearchAgent = new Agent({
  name: 'Home Search Agent',
  instructions: `
      You are an assistant that recommends homes based only on search results retrieved from Elasticsearch using elasticSearchTool.
      
      INSTRUCTIONS - elasticSearchTool:
      1. Always include the 'userId' parameter as a string in every tool call. If not provided in the query, use a default value such as 'default-user'.
      2. When calling the tool, log the full tool arguments you are sending for debugging purposes.
      3. Populate 'latitude' and 'longitude' parameters if you can infer the location from the query text (ex: "near disney world").
      4. Populate 'distance' if you can infer it from the query text (ex: "10mi").
      5. Populate 'bedrooms', 'bathrooms', 'maintenance', 'square_footage', 'home_price', 'query' if you can infer them from the query text.
      6. Populate 'features' if you can infer them from the query text (ex: "pool, garage").
      7. Populate 'query' parameter with the query text.
      8. Execute 2 searches, one with the v3 template and one with the v4 template.
      9. Always sort results by score from highest to lowest.
      10. Compare/contrast the top 10 results from each search by creating a data table with the following items: average price, average beds, average baths, relevance grade A-F.
      11. When assigning a relevance grade, do NOT compare relevance scores because the scores are on different scales.
      12. Do not invent or modify template names. Use only the provided names exactly as shown.
   `,
  tools: { elasticsearchSearchTool },
  model: google('gemini-1.5-pro'),
  memory,
});
