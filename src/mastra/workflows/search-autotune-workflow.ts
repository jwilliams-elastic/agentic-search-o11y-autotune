import { expandEnvVars } from '../../utils/env';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { elasticsearchSearchTool } from '../tools/elasticsearch-search-tool';
import { mockPropertyEngagementTool } from '../tools/mock-property-engagement-tool';
import { pythonTool } from '../tools/python-tool';
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
 searchesPerSession: z.number().default(5).describe('Number of searches per user session'),
 // Percentage of search results that will generate engagement events (0-100)
 engagementRate: z.number().default(85).describe('Percentage of search results that will generate engagement events (0-100)'),
 // Configurable user ID prefix for simulated users
 userIdPrefix: z.string().default('sim_user').describe('Prefix for generated user IDs'),
 // Optional Elasticsearch configuration
 elasticUrl: z.string().url().optional().describe('Elasticsearch URL'),
 elasticApiKey: z.string().optional().describe('Elasticsearch API key'),
 indexName: z.string().optional().describe('Index name for property data'),
 // Advanced configuration options with reasonable defaults
 maxSearchDelay: z.number().default(10).describe('Maximum delay between search operations in ms'),
 // Configurable search bias percentage (0-100, default 95)
 searchBiasPercent: z.number().min(0).max(100).default(95).describe('Percentage of searches that use preferred values (e.g., 3 bed, 2 bath, FL)'),
 // Property profile setting (LOW = standard homes, HIGH = luxury properties)
 propertyProfile: z.enum(['LOW', 'HIGH']).default('HIGH').describe('Property profile to simulate: LOW (3 bed, 2 bath, $100K-$500K) or HIGH (5+ bed, 4+ bath, $1M-$10M)'),
 // Percentage (0-100) of using v3 search template (default 80)
 v3TemplatePercent: z.number().min(0).max(100).default(80).describe('Percentage (0-100) of searches that use v3 search template (else v2)'),
});

// Output schema for the workflow
const workflowOutputSchema = z.object({
 success: z.boolean(),
 message: z.string(),
 stats: z.object({
  totalSearches: z.number(),
  totalEngagements: z.number(),
  // ...existing code...
  sessionsCompleted: z.number(),
  elapsedTimeMs: z.number()
 }),
 details: z.record(z.string(), z.any()).optional(),
});

// Helper function to generate random search parameters
function generateRandomSearchParams(session: number, searchNum: number, searchBiasPercent: number = 80, propertyProfile: 'LOW' | 'HIGH' = 'LOW', v3TemplatePercent: number = 80) {
 // Bias: configurable percentage of searches will use the preferred values, rest random
 let bedrooms, bathrooms, maintenance, state;
 const edgeCaseChance = 0.12; // 12% of the time, generate an edge case

 // Fix: ensure propertyProfile is a string (not a type)
 const profile = String(propertyProfile);

 if (profile === 'LOW') {
  if (Math.random() < (searchBiasPercent / 100)) {
   // Strong bias: 3 bed, 2 bath, low price
   bedrooms = 3;
   bathrooms = 2;
  } else if (Math.random() < edgeCaseChance) {
   // Edge cases: 1.5 baths, 4 beds, or very low/high price
   bedrooms = [2, 3, 4][Math.floor(Math.random() * 3)];
   bathrooms = [1.5, 2, 2.5, 3][Math.floor(Math.random() * 4)];
  } else {
   // More variety, but still in the affordable range
   bedrooms = Math.floor(Math.random() * 3) + 2; // 2, 3, or 4
   bathrooms = Math.floor(Math.random() * 3) * 0.5 + 1.5; // 1.5, 2.0, 2.5
  }
 } else {
  if (Math.random() < (searchBiasPercent / 100)) {
   // Strong bias: 5+ bed, 4+ bath, high price
   bedrooms = 5 + Math.floor(Math.random() * 3); // 5-7
   bathrooms = 4 + Math.floor(Math.random() * 3); // 4-6
  } else if (Math.random() < edgeCaseChance) {
   // Edge cases: 8 beds, 7 baths, or very high/low price
   bedrooms = [3, 4, 5, 6, 7, 8][Math.floor(Math.random() * 6)];
   bathrooms = [2, 3, 4, 5, 6, 7][Math.floor(Math.random() * 6)];
  } else {
   // More variety, but still in the luxury range
   bedrooms = Math.floor(Math.random() * 3) + 4; // 4, 5, 6
   bathrooms = Math.floor(Math.random() * 3) + 3; // 3, 4, 5
  }
 }

 // Set price range based on property profile, with some outliers
 let homePrice;
 if (propertyProfile === 'LOW') {
  if (Math.random() < edgeCaseChance) {
   homePrice = [150000, 550000, 600000][Math.floor(Math.random() * 3)];
  } else {
   homePrice = Math.floor(Math.random() * 250000) + 200000; // $200k-$450k
   if (homePrice > 500000) homePrice = 500000;
  }
 } else {
  if (Math.random() < edgeCaseChance) {
   homePrice = [700000, 12000000][Math.floor(Math.random() * 2)];
  } else {
   homePrice = Math.floor(Math.random() * 9000000) + 1000000; // $1M-$10M
  }
 }

 // Square footage based on property profile, with some outliers
 let squareFootage;
 if (propertyProfile === 'LOW') {
  if (Math.random() < edgeCaseChance) {
   squareFootage = [800, 5200][Math.floor(Math.random() * 2)];
  } else {
   squareFootage = Math.floor(Math.random() * 4500) + 500;
  }
 } else {
  if (Math.random() < edgeCaseChance) {
   squareFootage = [2500, 16000][Math.floor(Math.random() * 2)];
  } else {
   squareFootage = Math.floor(Math.random() * 12000) + 3000;
  }
 }

 // A set of common search queries based on property profile
 let searchQueries;
 
 if (propertyProfile === 'LOW') {
  // LOW profile: 3 bed, 2 bath homes in our target price range
  searchQueries = [
   "3 bedroom 2 bath home in Orlando under 250k",
   "3 bed 2 bath house with hurricane shutters in Tampa FL",
   "exact 3/2 home with pool in Miami FL under 350k",
   "only 3 bedroom 2 bathroom single family home in Fort Lauderdale ",
   "exactly 3 bedroom 2 bath single-story home in Jacksonville FL",
   "affordable 3 bedroom 2 bath home with low maintenance under 400k",
   "perfect 3/2 house in Sarasota under 500k",
   "3 bedroom 2 bath with lanai in Cape Coral under 450k",
   "3 bed 2 bath home near schools in Lakeland FL under 350k",
   "3 bedroom villa with 2 bathrooms in Naples under 250k",
   "3/2 home with open floor plan in St. Petersburg FL under 550k",
   // Added variety of locations, all 3 bed 2 bath under 500k
   "3 bedroom 2 bath near Atlanta GA under 500k",
   "3 bed 2 bath house in Houston TX under 400k",
   "affordable 3/2 home in Chicago IL under 350k",
   "3 bedroom 2 bath single family home in Atlanta GA under 450k",
   "3 bed 2 bath home under 500k",
   "3 bedroom 2 bath house in New York NY under 400k",
   "3/2 home with backyard in South Carolina under 375k",
   "3 bedroom 2 bath home in Georgia under 425k",
   "3 bed 2 bath house in IL under 475k",
   "3 bedroom 2 bath home in TX under 495k",
  ];
 } else {
  // HIGH profile: Luxury properties with 5+ bed, 4+ bath, $700k-$10M
  searchQueries = [
   // Luxury properties
   "5 bedroom 4 bath luxury home in Naples oceanfront",
   "6 bedroom 5 bath estate in Palm Beach FL over 1 million",
   "7 bedroom mansion in Miami Beach waterfront property",
   "5+ bedroom luxury home in Boca Raton with pool and spa",
   "6/5 luxury estate in Jupiter Island with ocean views",
   "Luxury 5 bedroom home in Fisher Island FL with private dock",
   "Exclusive 6 bedroom 6 bath property in Coral Gables with tennis court",
   "Premium 5 bedroom waterfront estate in Key Biscayne",
   "Multi-million dollar 7 bedroom home in Fort Lauderdale with yacht slip",
   "Ultra-luxury 6 bedroom 5 bath beach home in Longboat Key FL",
   // Luxury NY properties
   "5 bedroom luxury home in New York NY over 5 million",
   "6 bedroom estate in New York NY with ocean views",
   "Modern 5 bedroom 5 bath home in New York NY",
   "7 bedroom luxury villa in New York NY with vineyard",
   "Contemporary 6 bedroom mansion in New York NY over 3M",
   // Luxury New York properties
   "5 bedroom luxury penthouse in Manhattan NY",
   "6 bedroom brownstone in Brooklyn Heights NY with garden",
   "Luxurious 5 bedroom 5 bath apartment on Park Avenue",
   "7 bedroom estate in Hamptons NY oceanfront property",
   "Premium 6 bedroom residence in Tribeca New York",
   // Other luxury markets
   "5 bedroom luxury home in Texas on the water",
   "Exclusive 6 bedroom property in TX",
   "Luxury 7 bedroom 6 bath ranch in Austin TX over 2M",
   "Premium 5 bedroom estate in Texas with ocean views",
   "6 bedroom waterfront mansion in Chicago over 4 million"
  ];
 }

 // A set of property features to look for based on property profile
 let featuresList;
 
 if (propertyProfile === 'LOW') {
  // LOW profile: Features for 3 bed, 2 bath affordable homes
  featuresList = [
   // 15 features for 3 bed 2 bath homes
   "3 bedrooms, 2 bathrooms",
   "3/2 with ceiling fans",
   "3 bedroom 2 bath with laminate floors, easy landscaping",
   "3 bed 2 bath with pool, room",
   "3/2 with garage, palm trees",
   "3 bedroom 2 bath with energy efficient AC, sprinkler system",
   "3/2 home with community amenities, tennis courts",
   "3 bedroom 2 bath with open concept kitchen, breakfast nook",
   "3 bed 2 bath with walk-in closet, dual vanities",
   "3/2 single family home with fenced yard",
   "3 bedroom 2 bath with split floor plan",
   "3/2 with updated kitchen, granite countertops",
   "3 bedroom 2 bath near schools and shopping",
   "3 bed 2 bath home with good insulation, hurricane shutters",
   "3/2 home with covered patio",
   "low maintenance landscaping",
   "HOA under $1000/month",
   "good school district",
   "affordable property, low taxes",
   "easy commute to city center",
   "single family home with modern amenities",
   "family home with space for home office"
  ];
 } else {
  // HIGH profile: Features for luxury 5+ bed, 4+ bath homes
  featuresList = [
   // Luxury interior features
   "5 bedrooms, 5 bathrooms, private elevator, wine cellar",
   "6 bedroom estate with chef's kitchen, marble countertops",
   "7 bedroom mansion with home theater and spa bath",
   "5 bed 5 bath with smart home automation throughout",
   "6 bedroom luxury home with imported Italian tile, crystal chandeliers",
   "Luxury 5 bedroom with primary suite spanning entire floor",
   "6 bed 6 bath with 3 fireplaces and custom millwork",
   "7 bedroom estate with indoor basketball court and gym",
   "5 bedroom with gourmet kitchen, butler's pantry, 2 dishwashers",
   "6 bedroom with dedicated wine room and tasting area",
   // Luxury exterior features
   "Waterfront estate with private beach access and boat dock",
   "Gated mansion with 4-car garage and motor court",
   "Luxury property with infinity pool and outdoor kitchen",
   "Estate with tennis court, putting green, and landscaped gardens",
   "Oceanfront property with private cabana and beach access",
   "Mountain view estate with outdoor fireplace and heated terrace",
   "Luxury home with guest house and staff quarters",
   "Premium property with outdoor entertainment pavilion",
   "Gated estate with security system and caretaker residence",
   "Waterfront property with private yacht slip and boathouse",
   // General luxury features
   "Luxury property with designer finishes throughout",
   "Premium home with imported materials and fixtures"
  ];
 }

 // Select a random query and features
 const query = searchQueries[Math.floor(Math.random() * searchQueries.length)];
 const features = featuresList[Math.floor(Math.random() * featuresList.length)];

 // Base search parameters
 const params: any = {
  bedrooms,
  bathrooms,
  // Use correct field names for search template
  home_price: homePrice,
  square_footage: squareFootage,
  maintenance,
  query,
  features
 };
 if (state) {
  params.state = state;
 }
 // Use profile for further checks
 if (profile === 'LOW') {
  params.home_price = Math.min(params.home_price, 500000);
 }

 // Use v3 template v3TemplatePercent% of time, else v2 - avoid v4 to prevent circular dependency
 const templateSelector = Math.random();
 if (templateSelector < (v3TemplatePercent / 100)) {
  params.searchTemplateId = 'properties-search-v3';
 } else {
  params.searchTemplateId = 'properties-search-v2';
 }

 return params;
}

// Step to train the model using pythonTool
const trainModelStep = createStep({
 id: 'train-learn-to-rank-model',
 inputSchema: workflowOutputSchema,
 outputSchema: z.object({
  searchSimResult: workflowOutputSchema,
  trainResult: z.object({
   success: z.boolean(),
   message: z.string(),
   details: z.any().optional(),
  })
 }),
 execute: async ({ inputData, runtimeContext }) => {
  try {
   const result = await pythonTool.execute({
    context: {
     scriptCommand: 'train-model',
    },
    runtimeContext
   });
   if (!result.success) {
    throw new Error(result.message || 'Model training failed');
   }
   return {
    searchSimResult: inputData,
    trainResult: {
     success: result.success ?? true,
     message: result.message ?? 'Model training completed',
     details: result.details,
    }
   };
  } catch (err) {
   throw err;
  }
 },
});

// Step to deploy the model using pythonTool
const deployModelStep = createStep({
 id: 'deploy-learn-to-rank-model',
 inputSchema: z.object({
  searchSimResult: workflowOutputSchema,
  trainResult: z.object({
   success: z.boolean(),
   message: z.string(),
   details: z.any().optional(),
  })
 }),
 outputSchema: z.object({
  searchSimResult: workflowOutputSchema,
  trainResult: z.object({
   success: z.boolean(),
   message: z.string(),
   details: z.any().optional(),
  }),
  deployResult: z.object({
   success: z.boolean(),
   message: z.string(),
   details: z.any().optional(),
  })
 }),
 execute: async ({ inputData, runtimeContext }) => {
  try {
   const result = await pythonTool.execute({
    context: {
     scriptCommand: 'deploy-model',
    },
    runtimeContext
   });
   if (!result.success) {
    throw new Error(result.message || 'Model deployment failed');
   }
   return {
    searchSimResult: inputData.searchSimResult,
    trainResult: inputData.trainResult,
    deployResult: {
     success: result.success ?? true,
     message: result.message ?? 'Model deployment completed',
     details: result.details,
    }
   };
  } catch (err) {
   throw err;
  }
 },
});

// Step to run the search and engagement simulation
const simulateSearchAutotuneStep = createStep({
 id: 'simulate-search-sessions',
 inputSchema: workflowInputSchema,
 outputSchema: workflowOutputSchema,
 execute: async ({ inputData, runtimeContext }) => {
  try {
   const startTime = Date.now();
   const stats = {
    totalSearches: 0,
    totalEngagements: 0,
    // ...existing code...
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
     const searchParams = generateRandomSearchParams(
      sessionNum,
      searchNum,
      typeof inputData.searchBiasPercent === 'number' ? inputData.searchBiasPercent : 80,
      inputData.propertyProfile,
      typeof inputData.v3TemplatePercent === 'number' ? inputData.v3TemplatePercent : 80
     );
     
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
     if (!searchResult.success) {
      throw new Error(searchResult.message || 'Search tool failed');
     }
     
     stats.totalSearches++;
     
     // Ensure that the search results are correctly mapped to include home_price and other attributes
     if (searchResult.success && searchResult.results && searchResult.results.length > 0) {
       searchResult.results.forEach(result => {
         console.debug(`[DEBUG] Result object structure:`, result); // Log the entire result object for debugging
         sessionResults.push({
           id: result.id,
           title: result.property_title || result.address || `Property ${result.id}`,
           position: result.position,
           maintenance: result.maintenance,
           bedrooms: result.bedrooms || result['number-of-bedrooms']?.[0], // Extract bedrooms
           bathrooms: result.bathrooms || result['number-of-bathrooms']?.[0], // Extract bathrooms
           state: result.state,
           home_price: result.home_price || result['home-price']?.[0], // Correctly extract home_price
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
     let engagementCandidates = sessionResults;
     if (inputData.propertyProfile === 'LOW') {
       engagementCandidates = sessionResults.filter(r => {
         return (
           typeof r.bedrooms === 'number' && r.bedrooms === 3 &&
           typeof r.bathrooms === 'number' && r.bathrooms === 2 &&
           typeof r.home_price === 'number' && r.home_price <= 500000
         );
       });
       if (engagementCandidates.length === 0) {
         console.warn(`[WARNING] No valid engagement candidates found for LOW profile. Check data integrity.`);
       }
     } else if (inputData.propertyProfile === 'HIGH') {
       engagementCandidates = sessionResults.filter(r => {
         return (
           typeof r.bedrooms === 'number' && r.bedrooms >= 5 &&
           typeof r.bathrooms === 'number' && r.bathrooms >= 4 &&
           typeof r.home_price === 'number' && r.home_price >= 1000000
         );
       });
       if (engagementCandidates.length === 0) {
         console.warn(`[WARNING] No valid engagement candidates found for HIGH profile. Check data integrity.`);
       }
     }
     // If strict separation and no valid candidates for HIGH, skip engagement generation for this session
     if (inputData.propertyProfile === 'HIGH' && engagementCandidates.length === 0) {
       // No valid candidates for HIGH profile, skip engagement generation for this session
       stats.sessionsCompleted++;
       continue;
     }
     // Calculate how many engagements to simulate based on the engagement rate
     const numEngagements = Math.ceil((engagementCandidates.length * inputData.engagementRate) / 100);
     for (let i = 0; i < numEngagements; i++) {
      let result;
      if (Math.random() < 0.15) {
        // 15% of the time, pick a random property for engagement
        result = engagementCandidates[Math.floor(Math.random() * engagementCandidates.length)];
      } else {
        result = engagementCandidates[Math.min(i, engagementCandidates.length - 1)];
      }
      // Generate a realistic engagement message based on property profile
      let engagementMessages;
      
      if (inputData.propertyProfile === 'LOW') {
       engagementMessages = [
        `I'm interested in viewing this 3 bed 2 bath property ${result.id} under 400k`,
        `Can I schedule a viewing for this affordable ${result.title} in ? Love the 3/2 layout`,
        `What are the HOA fees for this 3 bedroom property ${result.id}? I'm looking for homes under 350k`,
        `Is this 3 bedroom home in still available? I'm not interested in South Carolina properties`,
        `I'd like more information about this 3/2 in under 400k`,
        `Are there any similar 3 bed 2 bath properties near ${result.title} in , not South Carolina?`,
        `Can you tell me more about the schools near this 3 bedroom home? I'm avoiding South Carolina`,
        `What's the square footage of this 3/2 property in ? I'm looking in the 200k-350k range`,
        `Has the price for this 3 bedroom 2 bath home changed recently? My budget is 350k max`,
        `I'd like to make an offer on this 3/2 property, not interested in South Carolina homes`,
        `Does this 3 bedroom home have hurricane shutters?`,
        `What are the property taxes on this 3/2 home in ? Looking for something affordable`,
        `How old is the AC unit in this 3 bedroom? I want a home, not South Carolina`,
        `Is this 3 bed 2 bath home in a flood zone? I'm specifically looking in `,
        `Are there any pending special assessments on this 3/2 property? My max budget is 400k`
       ];
      } else {
       // HIGH profile: Luxury 5+ bed, 4+ bath homes
       engagementMessages = [
        `I'm interested in scheduling a private tour of this luxury ${result.title}`,
        `What amenities are included with this ${(result.bedrooms ?? 5)}+ bedroom estate? Looking for a premium property`,
        `Is this luxury waterfront property still available? My budget is up to $8 million`,
        `Does this estate come with staff quarters? I need at least 5 bedrooms for the main residence`,
        `I'd like more details about the security features of this luxury ${result.title}`,
        `Are there any other premium properties comparable to ${result.title} in this area?`,
        `What are the property taxes on this luxury estate? Looking at properties $2-5 million`,
        `Does this property have a wine cellar and home theater? I need at least 6 bedrooms`,
        `Is the helipad on this estate FAA approved? I need a luxury property with easy access`,
        `What's the square footage of the master suite in this luxury home? I require at least 5 bedrooms total`,
        `I'd like to make an offer on this luxury property. Does it come fully furnished?`,
        `Does this estate have separate guest accommodations? I'm looking for a primary residence with 5+ bedrooms`,
        `What's the history of this architectural masterpiece? I collect luxury properties`,
        `Are there any conservation easements on this estate? I'm looking for privacy and exclusivity`,
        `How many cars does the garage accommodate? I need space for my collection in a luxury residence`
       ];
      }

      const messageIndex = Math.floor(Math.random() * engagementMessages.length);

      // Set up the engagement tool input, including query context for schema alignment
      // Use the same template used for search (v2 or v3) - never use v4 for training data
      const engagementToolInput = {
       userId,
       sessionId,
       userMessage: engagementMessages[messageIndex],
       position: result.position,
       documentId: result.id,
       lastSearchResults: sessionResults,
       // Provide query context for logging schema
       queryText: result.title, // Use property title as query.text for engagement
       queryTemplateId: 'properties-search-v3', // Always use v3 for training data
       queryResultCount: sessionResults.length
      };

      // Log engagement for observability with detailed information about property attributes
      console.log(`Engagement: User ${userId}, Document ${result.id}, Position ${result.position}, Template: ${engagementToolInput.queryTemplateId}, Profile: ${inputData.propertyProfile}, State: ${result.state}, Bedrooms: ${result.bedrooms}, Bathrooms: ${result.bathrooms}, Price: ${result.home_price}`);

      // For v4 template, add extra logging to help diagnose issues
      if (engagementToolInput.queryTemplateId === 'properties-search-v4') {
       if (inputData.propertyProfile === 'LOW') {
        console.log(`V4 TEMPLATE ENGAGEMENT: Strongly reinforcing 3 bed, 2 bath home preference for document ${result.id}`);
       } else {
        console.log(`V4 TEMPLATE ENGAGEMENT: Strongly reinforcing 5+ bed, 4+ bath luxury home preference for document ${result.id}`);
       }
      }

      await mockPropertyEngagementTool.execute({
       context: engagementToolInput,
       runtimeContext
      });

      stats.totalEngagements++;

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
    message: `Successfully simulated ${stats.totalSearches} searches and ${stats.totalEngagements} engagements across ${stats.sessionsCompleted} user sessions with ${inputData.propertyProfile} property profile`,
    stats,
    details: {
     startTime: new Date(startTime).toISOString(),
     endTime: new Date().toISOString(),
     configuration: {
      propertyProfile: inputData.propertyProfile,
      searchesPerSession: inputData.searchesPerSession,
      engagementRate: inputData.engagementRate
     }
    }
   };
  } catch (err) {
   throw err;
  }
 },
});

// Create the workflow
const searchAutotuneWorkflow = createWorkflow({
 id: 'search-autotune-workflow',
 description: 'Simulates property search and engagement traffic to generate data for observability and ML training, then trains and deploys a model.',
 inputSchema: workflowInputSchema,
 outputSchema: z.object({
  message: z.string(),
  searchSimResult: workflowOutputSchema,
  trainResult: z.object({
   success: z.boolean(),
   message: z.string(),
   details: z.any().optional(),
  }),
  deployResult: z.object({
   success: z.boolean(),
   message: z.string(),
   details: z.any().optional(),
  })
 }),
})
 .then(simulateSearchAutotuneStep)
 .then(trainModelStep)
 .then(deployModelStep)
 .then(createStep({
  id: 'completion-step',
  inputSchema: z.object({
   searchSimResult: workflowOutputSchema,
   trainResult: z.object({
    success: z.boolean(),
    message: z.string(),
    details: z.any().optional(),
   }),
   deployResult: z.object({
    success: z.boolean(),
    message: z.string(),
    details: z.any().optional(),
   })
  }),
  outputSchema: z.object({
   success: z.boolean(),
   message: z.string(),
   searchSimResult: workflowOutputSchema,
   trainResult: z.object({
    success: z.boolean(),
    message: z.string(),
    details: z.any().optional(),
   }),
   deployResult: z.object({
    success: z.boolean(),
    message: z.string(),
    details: z.any().optional(),
   })
  }),
  execute: async ({ inputData }) => {
   try {
    // Surface Python stdout/stderr if available
    let pythonStdout = '';
    let pythonStderr = '';
    if (inputData.deployResult?.details) {
     if (Array.isArray(inputData.deployResult.details.stdout)) {
      pythonStdout = inputData.deployResult.details.stdout.filter(Boolean).join('\n');
     }
     if (Array.isArray(inputData.deployResult.details.stderr)) {
      pythonStderr = inputData.deployResult.details.stderr.filter(Boolean).join('\n');
     }
    }
    let message = 'Search autotune workflow completed successfully.';
    if (pythonStdout || pythonStderr) {
     message += '\n--- Python Output ---';
     if (pythonStdout) message += `\nSTDOUT:\n${pythonStdout}`;
     if (pythonStderr) message += `\nSTDERR:\n${pythonStderr}`;
    }
    if (!inputData.searchSimResult?.success) {
     throw new Error(inputData.searchSimResult?.message || 'Search simulation failed');
    }
    if (!inputData.trainResult?.success) {
     throw new Error(inputData.trainResult?.message || 'Model training failed');
    }
    if (!inputData.deployResult?.success) {
     throw new Error(inputData.deployResult?.message || 'Model deployment failed');
    }
    return {
     success: Boolean(inputData.searchSimResult?.success) && Boolean(inputData.trainResult?.success) && Boolean(inputData.deployResult?.success),
     message,
     searchSimResult: inputData.searchSimResult,
     trainResult: inputData.trainResult,
     deployResult: inputData.deployResult
    };
   } catch (err) {
    throw err;
   }
  }
 }))
 .commit();

export { searchAutotuneWorkflow };