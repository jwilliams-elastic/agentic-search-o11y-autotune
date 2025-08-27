import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { logger } from '../logger-agentless';
import { expandEnvVars } from '../../utils/env';

function logPropertyEngagement({
  userId,
  sessionId,
  message,
  position,
  documentId,
  lastSearchResults
}: {
  userId: string,
  sessionId: string,
  message: string,
  position: number,
  documentId: string,
  lastSearchResults: Array<{ id: string; title: string; position: number }>
}) {
  logger.info({
    '@timestamp': new Date().toISOString(),
    'event.action': 'property_engagement',
    'event.type': 'engagement',
    'event.category': ['user'],
    'event.outcome': 'success',
    'user.id': userId,
    'session.id': sessionId,
    'query.text': lastSearchResults && lastSearchResults.length > 0 ? lastSearchResults[0].title : undefined,
    'query.template_id': undefined, // Not available in this context
    'query.result_count': lastSearchResults ? lastSearchResults.length : undefined,
    'result': {
      document_id: documentId,
      position: position
    },
    'interaction': {
      type: 'property_engagement',
      original_message: message
    },
    'service.name': 'mock-property-engagement-tool'
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
    logPropertyEngagement({
      userId: context.userId,
      sessionId,
      message: context.userMessage,
      position: context.position,
      documentId: context.documentId,
      lastSearchResults: context.lastSearchResults
    });
    
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
