import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { config } from 'dotenv';

config();

const inputSchema = z.object({
  userId: z.string().describe('ID of the user performing the action'),
  id: z.string().describe('ID of the property'),
  searchSessionId: z.string().optional().describe('ID of the search session (if available)'),
  referrer: z.string().optional().describe('Source of the engagement (e.g., "search_results", "recommendations")'),
  metadata: z.record(z.string(), z.any()).optional().describe('Additional metadata about the engagement event'),
  engagementAction: z.enum(['PROPERTY_CLICK_THROUGH', 'PROPERTY_REQUEST_CONTACT', 'PROPERTY_NOT_RELEVANT']).optional().describe('Type of engagement (choose one: "PROPERTY_CLICK_THROUGH", "PROPERTY_REQUEST_CONTACT", "PROPERTY_NOT_RELEVANT")')
});

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z.record(z.string(), z.any()).optional(),
});

/**
 * Logs a property engagement event when a user clicks on a property listing
 * This is a mock implementation that only logs the event without performing actual actions
 */
const logPropertyEngagement = async (params: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> => {
  try {
    // Extract parameters=
    console.log({ event: { type: 'PROPERTY_ENGAGEMENT', params: params} });
    
    return {
      success: true,
      message: `Successfully logged PROPERTY_ENGAGEMENT event with params: ${JSON.stringify(params)}`,
      details: {
        params
      }
    };
  } catch (error: any) {
    return { 
      success: false, 
      message: `Error logging event: ${error.message}`,
      details: { error: error.message }
    };
  }
};

export const propertyEngagementTool = createTool({
  id: 'property-engagement-tool',
  description: 'Logs an engagement event for a property listing. This is a mock tool that simulates tracking user engagement with search results.',
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    return await logPropertyEngagement(context);
  },
});
