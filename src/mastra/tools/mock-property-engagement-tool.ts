import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { logger } from '../logger-agentless';

function logPropertyEngagement(userId: string, sessionId: string, message: string, position: number, documentId: string) {
  logger.info({
    '@timestamp': new Date().toISOString(),
    'event.action': 'agent_user_interactions',
    'event.category': ['user'],
    'event.outcome': 'success',
    'user.id': userId,
    'search.session_id': sessionId,
    'search.interaction': {
      document_id: documentId,
      position: position,
      type: 'property_engagement',
      original_message: message
    },
    'service': {
      name: 'mock-property-engagement-tool'
    }
  });
}

const inputSchema = z.object({
  userId: z.string().describe('ID of the user performing the search'),
  sessionId: z.string().optional().describe('Search session ID for tracking interactions across tools'),
  userMessage: z.string().describe('User message related to property engagement'),
  position: z.number().describe('Position of the property in search results'),
  documentId: z.string().describe('ID of the property document being engaged with'),
  lastSearchResults: z.array(z.object({
    id: z.string(),
    title: z.string(),
    position: z.number()
  })).describe('Previous search results'),
});

const eventSchema = z.object({
  detected: z.boolean(),
  position: z.number(),
  document_id: z.string(),
  type: z.string(),
});

const outputSchema = z.union([
  eventSchema,
  z.object({ events: z.array(eventSchema) })
]);

export const mockPropertyEngagementTool = createTool({
  id: 'mock-property-engagement-tool',
  description: 'Logs property engagement events for observability and LTR training.',
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    // Use provided sessionId or generate one if not provided
    const sessionId = context.sessionId || `mock_session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // Log the engagement
    logPropertyEngagement(
      context.userId,
      sessionId,
      context.userMessage,
      context.position,
      context.documentId
    );
    
    // Return the engagement event
    const event = {
      detected: true,
      position: context.position,
      document_id: context.documentId,
      type: 'property_engagement'
    };
    
    return event;
  },
});
