import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { config } from 'dotenv';

config();

const inputSchema = z.object({
  userId: z.string().describe('ID of the user performing the click-through action'),
  id: z.string().describe('ID of the property that was clicked on'),
  searchSessionId: z.string().optional().describe('ID of the search session (if available)'),
  referrer: z.string().optional().describe('Source of the click-through (e.g., "search_results", "recommendations")'),
  metadata: z.record(z.string(), z.any()).optional().describe('Additional metadata about the click-through event'),
});

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z.record(z.string(), z.any()).optional(),
});

/**
 * Logs a property click-through event when a user clicks on a property listing
 * This is a mock implementation that only logs the event without performing actual actions
 */
const logPropertyClickThrough = async (params: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> => {
  try {
    // Extract parameters
    const { userId, id, searchSessionId, referrer, metadata } = params;
    
    // Create event object for logging
    const eventData = {
      type: 'PROPERTY_CLICK_THROUGH',
      userId,
      id,
      timestamp: new Date().toISOString(),
      searchSessionId,
      referrer: referrer || 'unknown',
      metadata: metadata || {},
    };
    
    // Log the event
    console.log({ 
      event: eventData
    });
    
    return {
      success: true,
      message: `Successfully logged click-through event for user ${userId} on property ${id}`,
      details: {
        eventData
      }
    };
  } catch (error: any) {
    return { 
      success: false, 
      message: `Error logging click-through event: ${error.message}`,
      details: { error: error.message }
    };
  }
};

export const propertyClickThroughTool = createTool({
  id: 'property-click-through-tool',
  description: 'Logs a click-through event when a user clicks on a property listing. This is a mock tool that simulates tracking user engagement with search results.',
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    return await logPropertyClickThrough(context);
  },
});
