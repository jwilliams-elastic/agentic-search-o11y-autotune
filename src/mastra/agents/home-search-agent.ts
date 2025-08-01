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
      You can also detect conversational references to specific properties based on user messages and log interactions for LTR training with mockPropertyEngagementTool.

      INSTRUCTIONS - elasticSearchTool:
      1. populate 'latitude' and longitude parameters if you can infer the location from the query text.(ex: "near disney world")
      2. populate 'distance' if you can infer it from the query text.(ex: "10mi")
      3. populate 'bedrooms', 'bathrooms', 'maintenance', 'square_footage', 'home_price', 'query' if you can infer them from the query text.
      4. populate 'features' if you can infer them from the query text.(ex: "pool, garage")
      5. populate 'query' parameter with the query text
      6. return the results from the elasticSearchTool
      7. Use elasticsearchSearchTool with enableLTR=true for intelligent reranking when you need enhanced relevance

      INSTRUCTIONS - mockPropertyEngagementTool:
      1. When user provides a message that references a specific property, use mockPropertyEngagementTool to detect the conversational reference.
      2. If a range of properties is mentioned in this format(result 1-3) convert 'userMessage' to a comma-separated string of messages (e.g., "result 1, result 2, result 3").
      3. Use the 'userMessage' and 'lastSearchResults' to analyze the message for conversational references.
      4. If a reference is detected, log the interaction with confidence score and position.
  `,
  tools: { elasticsearchSearchTool, mockPropertyEngagementTool },
  model: openai('gpt-4o'),
  memory: new Memory({
    storage: new LibSQLStore({
      url: 'file:../mastra.db', // path is relative to the .mastra/output directory
    }),
  }),
});
