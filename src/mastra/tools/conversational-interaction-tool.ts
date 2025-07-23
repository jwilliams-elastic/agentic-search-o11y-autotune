/**
 * Conversational Interaction Tool
 * Detects and logs position-aware interactions from natural language
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { fileLogger } from '../logger-agentless';

// Position detection patterns
const POSITION_PATTERNS = [
  // Ordinal patterns
  { pattern: /\b(?:the\s+)?first\s+(?:property|result|item|listing|house|home)\b/i, position: 1 },
  { pattern: /\b(?:the\s+)?second\s+(?:property|result|item|listing|house|home)\b/i, position: 2 },
  { pattern: /\b(?:the\s+)?third\s+(?:property|result|item|listing|house|home)\b/i, position: 3 },
  { pattern: /\b(?:the\s+)?fourth\s+(?:property|result|item|listing|house|home)\b/i, position: 4 },
  { pattern: /\b(?:the\s+)?fifth\s+(?:property|result|item|listing|house|home)\b/i, position: 5 },
  
  // Numeric patterns
  { pattern: /\b(?:property|result|item|listing|house|home)\s+(?:#\s*)?(\d+)\b/i, position: 'match' },
  { pattern: /\b(?:the\s+)?(\d+)(?:st|nd|rd|th)\s+(?:property|result|item|listing|house|home)\b/i, position: 'match' },
  
  // General reference patterns
  { pattern: /\btop\s+(?:property|result|item|listing|house|home)\b/i, position: 1 },
  { pattern: /\bbest\s+(?:property|result|item|listing|house|home)\b/i, position: 1 },
  { pattern: /\bthat\s+(?:one|property|result|item|listing|house|home)\b/i, position: 1 }, // Assumes referring to most recent
];

// Action detection patterns
const ACTION_PATTERNS = [
  { pattern: /\b(?:tell me about|show me|more info|details about|learn more|info on)\b/i, action: 'click' },
  { pattern: /\b(?:interested in|like|want to see|check out)\b/i, action: 'view' },
  { pattern: /\b(?:save|bookmark|remember)\b/i, action: 'bookmark' },
  { pattern: /\b(?:share|send|email)\b/i, action: 'share' },
];

export const conversationalInteractionTool = createTool({
  name: 'conversationalInteractionTool',
  description: 'Detects conversational references to search results and logs position-aware interactions automatically',
  inputSchema: z.object({
    message: z.string().describe('User message to analyze for conversational references'),
    userId: z.string().describe('User ID for interaction logging'),
    sessionId: z.string().optional().describe('Current search session ID'),
    lastSearchResults: z.array(z.object({
      id: z.string(),
      title: z.string(),
      position: z.number()
    })).optional().describe('Recent search results for context')
  }),
  
  async execute(params) {
    try {
      const { message, userId, sessionId, lastSearchResults = [] } = params;
      
      console.log(`🎧 Analyzing conversational message: "${message}"`);
      
      // Detect position references
      let detectedPosition: number | null = null;
      let detectedAction = 'click'; // Default action
      
      // Check position patterns
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
      
      // Check action patterns
      for (const actionPattern of ACTION_PATTERNS) {
        if (actionPattern.pattern.test(message)) {
          detectedAction = actionPattern.action;
          break;
        }
      }
      
      // If no specific position detected, check for general interest indicators
      if (!detectedPosition && (
        /\b(?:this|that|it)\b/i.test(message) ||
        /\b(?:more|details)\b/i.test(message)
      )) {
        detectedPosition = 1; // Assume referring to top result
      }
      
      // Log the interaction if position detected
      if (detectedPosition && lastSearchResults.length >= detectedPosition) {
        const targetResult = lastSearchResults.find(r => r.position === detectedPosition);
        
        if (targetResult) {
          const interactionLog = {
            '@timestamp': new Date().toISOString(),
            'event.kind': 'event',
            'event.category': ['user'],
            'event.type': ['access'],
            'event.action': 'conversational_interaction_detected',
            'event.outcome': 'success',
            'user.id': userId,
            'search.session_id': sessionId || 'unknown',
            'search.interaction': {
              document_id: targetResult.id,
              position: detectedPosition,
              type: detectedAction,
              trigger: 'conversational',
              original_message: message,
              detected_pattern: 'natural_language'
            },
            'labels': {
              service: 'agentic-search-conversational',
              environment: process.env.NODE_ENV || 'development',
            }
          };
          
          // Log via agentless logger
          fileLogger.info(interactionLog);
          
          console.log(`💬 Conversational interaction detected:`);
          console.log(`   Position: ${detectedPosition}`);
          console.log(`   Action: ${detectedAction}`);
          console.log(`   Target: ${targetResult.title}`);
          
          return {
            success: true,
            detected: true,
            position: detectedPosition,
            action: detectedAction,
            targetResult: targetResult,
            message: `Logged ${detectedAction} interaction at position ${detectedPosition}: "${targetResult.title}"`
          };
        }
      }
      
      // No interaction detected
      console.log(`🤷 No conversational interaction detected in: "${message}"`);
      
      return {
        success: true,
        detected: false,
        message: "No position-aware interaction detected in message"
      };
      
    } catch (error) {
      console.error('❌ Conversational interaction detection failed:', error);
      
      const errorLog = {
        '@timestamp': new Date().toISOString(),
        'event.kind': 'event',
        'event.category': ['error'],
        'event.type': ['error'],
        'event.action': 'conversational_interaction_error',
        'event.outcome': 'failure',
        'error.message': error.message,
        'error.type': error.constructor.name,
        'user.id': params.userId,
        'labels': {
          service: 'agentic-search-conversational',
          environment: process.env.NODE_ENV || 'development',
        }
      };
      
      fileLogger.error(errorLog);
      
      return {
        success: false,
        detected: false,
        error: error.message
      };
    }
  }
});
