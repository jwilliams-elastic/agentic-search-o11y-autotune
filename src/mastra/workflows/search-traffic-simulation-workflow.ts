import { createWorkflow, createStep } from '@mastra/core/workflows';
import { elasticsearchSearchTool } from '../tools/elasticsearch-search-tool';
import { mockPropertyEngagementTool } from '../tools/mock-property-engagement-tool';
import { z } from 'zod';

/**
 * This workflow simulates search and engagement traffic by executing multiple invocations
 * of the Elasticsearch search tool and mock property engagement tool.
 * It's designed to generate realistic user behavior data for testing and training purposes.
 * 
 * Features:
 * - Configurable number of user sessions and searches per session
 * - Realistic property search parameters with randomization
 * - Simulated user engagement with search results
 * - Position bias for engagement (70% of engagements target positions 6-10)
 * - Detailed logging for observability and ML training
 */

// Input schema for the workflow with configuration options
const workflowInputSchema = z.object({
  // Number of user sessions to simulate
  numSessions: z.number().default(100).describe('Number of user sessions to simulate'),
  // Number of searches per session
  searchesPerSession: z.number().default(3).describe('Number of searches per user session'),
  // Percentage of search results that will generate engagement events (0-100)
  engagementRate: z.number().default(50).describe('Percentage of search results that will generate engagement events (0-100)'),
  // Configurable user ID prefix for simulated users
  userIdPrefix: z.string().default('sim_user').describe('Prefix for generated user IDs'),
  // Optional Elasticsearch configuration
  elasticUrl: z.string().url().optional().describe('Elasticsearch URL'),
  elasticApiKey: z.string().optional().describe('Elasticsearch API key'),
  indexName: z.string().optional().describe('Index name for property data'),
  // Advanced configuration options with reasonable defaults
  simulateGeoSearch: z.boolean().default(true).describe('Whether to include geo-based searches in the simulation'),
  maxSearchDelay: z.number().default(10).describe('Maximum delay between search operations in ms'),
  // Position bias configuration
  positionBiasEnabled: z.boolean().default(true).describe('Whether to apply position bias for engagements'),
  positionBiasStrength: z.number().default(70).describe('Percentage chance (0-100) to select from biased positions'),
  positionBiasMinRange: z.number().default(6).describe('Min position for biased selection'),
  positionBiasMaxRange: z.number().default(10).describe('Max position for biased selection')
});

// Output schema for the workflow
const workflowOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  stats: z.object({
    totalSearches: z.number(),
    totalEngagements: z.number(),
    biasedEngagements: z.number(),
    sessionsCompleted: z.number(),
    elapsedTimeMs: z.number()
  }),
  details: z.record(z.string(), z.any()).optional(),
});

// Helper function to generate random search parameters
function generateRandomSearchParams(session: number, searchNum: number, useGeo: boolean) {
  // Bias: 40% of searches will use the preferred values, rest random
  let bedrooms, bathrooms, maintenance, state;
  if (Math.random() < 0.4) {
    bedrooms = 3;
    bathrooms = 2;
    maintenance = Math.floor(Math.random() * 200); // lower maintenance fee
    state = "FL";
  } else {
    bedrooms = Math.floor(Math.random() * 5) + 1;
    bathrooms = Math.floor(Math.random() * 5) + 1;
    maintenance = Math.floor(Math.random() * 1000);
    // 20% chance to pick Florida randomly
    state = Math.random() < 0.2 ? "FL" : undefined;
  }

  // Random price between $100k and $2M
  const homePrice = Math.floor(Math.random() * 1900000) + 100000;
  // Random square footage between 500 and 5000
  const squareFootage = Math.floor(Math.random() * 4500) + 500;

  // A set of common search queries
  const searchQueries = [
    "modern home with open floor plan",
    "waterfront property with pool",
    "luxury condo with city views",
    "family home in quiet neighborhood",
    "renovated townhouse with garage",
    "single-story house with large yard",
    "downtown apartment with gym access",
    "historic home with original features",
    "new construction with smart home features",
    "pet-friendly apartment with outdoor space"
  ];

  // A set of property features to look for
  const featuresList = [
    "hardwood floors, stainless appliances",
    "swimming pool, outdoor kitchen",
    "home office, high ceilings",
    "walk-in closets, marble countertops",
    "smart home, energy efficient",
    "garage, basement storage",
    "fireplace, deck",
    "security system, fenced yard",
    "updated kitchen, spa bathroom",
    "balcony, concierge service"
  ];

  // Select a random query and features
  const query = searchQueries[Math.floor(Math.random() * searchQueries.length)];
  const features = featuresList[Math.floor(Math.random() * featuresList.length)];

  // Base search parameters
  const params: any = {
    bedrooms,
    bathrooms,
    home_price: homePrice,
    square_footage: squareFootage,
    maintenance,
    query,
    features
  };
  if (state) {
    params.state = state;
  }

  // Add geo search parameters if enabled (using Florida coordinates if state=FL, else NYC)
  if (useGeo) {
    let baseLat, baseLng;
    if (state === "FL") {
      // Central Florida (Orlando area)
      baseLat = 28.5383;
      baseLng = -81.3792;
    } else {
      // Manhattan
      baseLat = 40.7128;
      baseLng = -74.0060;
    }
    // Add some randomness to the coordinates
    const latitude = (baseLat + (Math.random() * 0.5 - 0.25)).toFixed(6);
    const longitude = (baseLng + (Math.random() * 0.5 - 0.25)).toFixed(6);
    // Random distance between 1km and 20km
    const distance = Math.floor(Math.random() * 19 + 1) + "km";
    params.latitude = latitude;
    params.longitude = longitude;
    params.distance = distance;
  }

  // Randomly select search template version (weighted toward v3)
  //const templateVersions = ['properties-search-v1', 'properties-search-v2', 'properties-search-v3', 'properties-search-v3', 'properties-search-v4'];
  params.searchTemplateId = 'properties-search-v3';

  return params;
}

// Step to run the search and engagement simulation
const simulateSearchTrafficStep = createStep({
  id: 'simulate-search-traffic',
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData, runtimeContext }) => {
    const startTime = Date.now();
    const stats = {
      totalSearches: 0,
      totalEngagements: 0,
      biasedEngagements: 0,  // Track biased engagements
      sessionsCompleted: 0,
      elapsedTimeMs: 0
    };
    
    // Process each user session
    for (let sessionNum = 1; sessionNum <= inputData.numSessions; sessionNum++) {
      const userId = `${inputData.userIdPrefix}_${sessionNum}`;
      const sessionId = `sim_session_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      console.log(`Simulating session ${sessionNum}/${inputData.numSessions} for user ${userId}`);

      // Track session results for engagements, now with property attributes for biasing
      type SessionResult = {
        id: string;
        title: string;
        position: number;
        maintenance?: number;
        bedrooms?: number;
        bathrooms?: number;
        state?: string;
        home_price?: number;
        annual_tax?: number;
      };
      const sessionResults: Array<SessionResult> = [];
      
      // Execute searches for this session
      for (let searchNum = 1; searchNum <= inputData.searchesPerSession; searchNum++) {
        // Generate random search parameters
        const useGeo = inputData.simulateGeoSearch && Math.random() > 0.5;
        const searchParams = generateRandomSearchParams(sessionNum, searchNum, useGeo);
        
        // Set up the search tool input
        const searchToolInput = {
          userId,
          sessionId,
          ...searchParams,
          logInteractions: true
        };
        
        // Execute the search
        const searchResult = await elasticsearchSearchTool.execute({ 
          context: searchToolInput, 
          runtimeContext 
        });
        
        stats.totalSearches++;
        
        // Store the search results for potential engagement
        if (searchResult.success && searchResult.results && searchResult.results.length > 0) {
          searchResult.results.forEach(result => {
            sessionResults.push({
              id: result.id,
              title: result.property_title || result.address || `Property ${result.id}`,
              position: result.position,
              // Add property attributes for engagement bias
              maintenance: result.maintenance,
              bedrooms: result.bedrooms,
              bathrooms: result.bathrooms,
              state: result.state,
              home_price: result.home_price,
              annual_tax: result.annual_tax
            });
          });
        }
        
        // Add a small delay between searches to avoid overwhelming the system
        if (inputData.maxSearchDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, Math.random() * inputData.maxSearchDelay));
        }
      }
      
      // Process engagements for this session if we have results
      if (sessionResults.length > 0) {
        // Calculate how many engagements to simulate based on the engagement rate
        const numEngagements = Math.ceil((sessionResults.length * inputData.engagementRate) / 100);

        // Generate random engagement events
        for (let i = 0; i < numEngagements; i++) {
          // Pick a result to engage with
          // Implement bias towards positions in the configured range and property attributes
          let resultIndex: number;

          // Apply position bias based on configuration
          const usePositionBias = inputData.positionBiasEnabled && Math.random() < (inputData.positionBiasStrength / 100);
          const positionBiasedResults = sessionResults.filter(
            r => r.position >= inputData.positionBiasMinRange && 
                 r.position <= inputData.positionBiasMaxRange
          );


          // Enhanced attribute bias: prefer low home price, low maintenance, low annual tax, and FL state
          // Strongest bias for FL, then for low price/maintenance/tax
          const FL_BIAS_WEIGHT = 2.0; // FL gets double weight
          const LOW_PRICE_THRESHOLD = 400000;
          const LOW_MAINTENANCE_THRESHOLD = 200;
          const LOW_TAX_THRESHOLD = 3000;

          // Build a weighted list for attribute bias
          const attributeWeightedResults: Array<{r: SessionResult, weight: number}> = sessionResults.map(r => {
            let weight = 1;
            if (typeof r.state !== 'undefined' && r.state === 'FL') {
              weight *= FL_BIAS_WEIGHT;
            }
            if (typeof r.home_price !== 'undefined' && r.home_price <= LOW_PRICE_THRESHOLD) {
              weight += 1;
            }
            if (typeof r.maintenance !== 'undefined' && r.maintenance <= LOW_MAINTENANCE_THRESHOLD) {
              weight += 1;
            }
            if (typeof r.annual_tax !== 'undefined' && r.annual_tax <= LOW_TAX_THRESHOLD) {
              weight += 1;
            }
            return { r, weight };
          }).filter(({weight}) => weight > 1); // Only keep those with some bias

          // Build a flat array for weighted random selection
          const attributeBiasedPool: SessionResult[] = [];
          attributeWeightedResults.forEach(({r, weight}) => {
            for (let i = 0; i < weight; i++) {
              attributeBiasedPool.push(r);
            }
          });

          let usedAttributeBias = false;
          if (attributeBiasedPool.length > 0 && Math.random() < 0.7) { // 70% chance to use attribute bias if available
            const attrIndex = Math.floor(Math.random() * attributeBiasedPool.length);
            resultIndex = sessionResults.findIndex(r => r.id === attributeBiasedPool[attrIndex].id);
            usedAttributeBias = true;
          } else if (usePositionBias && positionBiasedResults.length > 0) {
            // Select from biased position range
            const biasedIndex = Math.floor(Math.random() * positionBiasedResults.length);
            resultIndex = sessionResults.findIndex(r => r.id === positionBiasedResults[biasedIndex].id);
          } else {
            // Fallback to random selection from all results
            resultIndex = Math.floor(Math.random() * sessionResults.length);
          }

          const result = sessionResults[resultIndex];

          // Generate a realistic engagement message
          const engagementMessages = [
            `I'm interested in property ${result.id}`,
            `Can I schedule a viewing for ${result.title}?`,
            `What are the HOA fees for property ${result.id}?`,
            `Is ${result.title} still available?`,
            `I'd like more information about ${result.title}`,
            `Are there any similar properties to ${result.title}?`,
            `Can you tell me more about the neighborhood around ${result.title}?`,
            `What's the square footage of ${result.title}?`,
            `Has the price for ${result.title} changed recently?`,
            `I'd like to make an offer on ${result.title}`
          ];

          const messageIndex = Math.floor(Math.random() * engagementMessages.length);

          // Set up the engagement tool input
          const engagementToolInput = {
            userId,
            sessionId,
            userMessage: engagementMessages[messageIndex],
            position: result.position,
            documentId: result.id,
            lastSearchResults: sessionResults
          };

          // Execute the engagement
          const isBiasedSelection = positionBiasedResults.some(r => r.id === result.id);
          // Track attribute bias for logging
          const isAttributeBiased = usedAttributeBias;

          // Log additional metadata about position/attribute bias for observability
          console.log(`Engagement: User ${userId}, Document ${result.id}, Position ${result.position}, Position Biased: ${isBiasedSelection}, Attribute Biased: ${isAttributeBiased}`);

          // Add bias information to the message to preserve it in logs
          let biasInfo = '';
          if (isBiasedSelection) biasInfo += ' [POSITION_BIASED]';
          if (isAttributeBiased) biasInfo += ' [ATTRIBUTE_BIASED]';
          const enhancedMessage = engagementMessages[messageIndex] + biasInfo;

          await mockPropertyEngagementTool.execute({
            context: {
              ...engagementToolInput,
              userMessage: enhancedMessage
            },
            runtimeContext
          });

          stats.totalEngagements++;
          if (isBiasedSelection) {
            stats.biasedEngagements++;
          }

          // Add a small delay between engagements
          if (inputData.maxSearchDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, Math.random() * inputData.maxSearchDelay / 2));
          }
        }
      }
      
      stats.sessionsCompleted++;
    }
    
    stats.elapsedTimeMs = Date.now() - startTime;
    
    return {
      success: true,
      message: `Successfully simulated ${stats.totalSearches} searches and ${stats.totalEngagements} engagements (${stats.biasedEngagements} biased to positions ${inputData.positionBiasMinRange}-${inputData.positionBiasMaxRange}) across ${stats.sessionsCompleted} user sessions`,
      stats,
      details: {
        startTime: new Date(startTime).toISOString(),
        endTime: new Date().toISOString(),
        configuration: {
          searchesPerSession: inputData.searchesPerSession,
          engagementRate: inputData.engagementRate,
          simulateGeoSearch: inputData.simulateGeoSearch,
          positionBias: {
            enabled: inputData.positionBiasEnabled,
            strength: inputData.positionBiasStrength,
            range: `${inputData.positionBiasMinRange}-${inputData.positionBiasMaxRange}`
          }
        }
      }
    };
  },
});

// Create the workflow
const searchTrafficSimulationWorkflow = createWorkflow({
  id: 'search-traffic-simulation-workflow',
  description: 'Simulates property search and engagement traffic to generate data for observability and ML training',
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
.then(simulateSearchTrafficStep);

// Commit the workflow
searchTrafficSimulationWorkflow.commit();

export { searchTrafficSimulationWorkflow };
