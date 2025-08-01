import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { logger } from '../logger-agentless';

// Conversational pattern detection
const POSITION_PATTERNS = [
  { pattern: /\b(?:first|1st)\b/i, position: 1 },
  { pattern: /\b(?:second|2nd)\b/i, position: 2 },
  { pattern: /\b(?:third|3rd)\b/i, position: 3 },
  { pattern: /\bproperty\s+(\d+)\b/i, position: 'match' },
  { pattern: /\bresult\s+(\d+)\b/i, position: 'match' },
  { pattern: /\bnumber\s+(\d+)\b/i, position: 'match' }
];

function calculateConfidenceScore(message: string, position: number | null): number {
  if (!position) return 0.5;
  let confidence = 0.6;
  if (/\b(first|1st)\b/i.test(message)) confidence += 0.25;
  if (/\b(second|2nd)\b/i.test(message)) confidence += 0.25;
  if (/\b(third|3rd)\b/i.test(message)) confidence += 0.25;
  if (/\b(property|listing|home|house)\s*#?\s*\d+/i.test(message)) confidence += 0.3;
  if (/\b(tell me about|show me|more info|details about)\b/i.test(message)) confidence += 0.15;
  if (/\b(that one|this one|the one)\b/i.test(message)) confidence += 0.1;
  if (/\btop\s*(result|property|listing)/i.test(message)) confidence += 0.2;
  if (/\babove\b/i.test(message)) confidence += 0.15;
  if (/\b(maybe|might|could|perhaps)\b/i.test(message)) confidence -= 0.1;
  if (/\b(or|either|any)\b/i.test(message)) confidence -= 0.05;
  return Math.max(0.5, Math.min(1.0, confidence));
}

function detectConversationalInteraction(message: string, userId: string, sessionId: string, lastSearchResults: any[] = []) {
  let detectedPosition: number | null = null;
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
  if (!detectedPosition && (
    /\b(?:this|that|it)\b/i.test(message) ||
    /\b(?:more|details)\b/i.test(message)
  )) {
    detectedPosition = 1;
  }
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
          name: 'mock-property-engagement-tool'
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

const inputSchema = z.object({
  userId: z.string().describe('ID of the user performing the search'),
  userMessage: z.string().describe('User message to analyze for conversational references'),
  lastSearchResults: z.array(z.object({
    id: z.string(),
    title: z.string(),
    position: z.number()
  })).describe('Previous search results for conversational detection'),
});

const eventSchema = z.object({
  detected: z.boolean(),
  position: z.number().optional(),
  document_id: z.string().optional(),
  type: z.string().optional(),
});

const outputSchema = z.union([
  eventSchema,
  z.object({ events: z.array(eventSchema) })
]);

export const mockPropertyEngagementTool = createTool({
  id: 'mock-property-engagement-tool',
  description: 'Detects conversational engagement with property search results and logs interactions for observability and LTR training.',
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    const sessionId = `mock_session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    // Split userMessage by comma, trim whitespace, and filter out empty strings
    const messages = context.userMessage.split(',').map(m => m.trim()).filter(Boolean);
    const results = messages.map(message =>
      detectConversationalInteraction(
        message,
        context.userId,
        sessionId,
        context.lastSearchResults
      )
    );
    // If only one message, return single result for backward compatibility
    if (results.length === 1) {
      return results[0];
    }
    // Otherwise, return array of results
    return { events: results };
  },
});
