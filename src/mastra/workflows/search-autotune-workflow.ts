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
  numSessions: z.number().default(200).describe('Number of user sessions to simulate'),
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
  simulateGeoSearch: z.boolean().default(true).describe('Whether to include geo-based searches in the simulation'),
  maxSearchDelay: z.number().default(10).describe('Maximum delay between search operations in ms'),
  // Configurable search bias percentage (0-100, default 95)
  searchBiasPercent: z.number().min(0).max(100).default(95).describe('Percentage of searches that use preferred values (e.g., 3 bed, 2 bath, FL)'),
  // Property profile setting (LOW = standard homes, HIGH = luxury properties)
  propertyProfile: z.enum(['LOW', 'HIGH']).default('LOW').describe('Property profile to simulate: LOW (3 bed, 2 bath, $100K-$500K) or HIGH (5+ bed, 4+ bath, $700K-$10M)'),
  // ...existing code...
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
function generateRandomSearchParams(session: number, searchNum: number, useGeo: boolean, searchBiasPercent: number = 80, propertyProfile: 'LOW' | 'HIGH' = 'LOW') {
  // Bias: configurable percentage of searches will use the preferred values, rest random
  let bedrooms, bathrooms, maintenance, state;
  
  if (propertyProfile === 'LOW') {
    // LOW profile: 3 bed, 2 bath, affordable homes
    if (Math.random() < (searchBiasPercent / 100)) {
      // Our primary target properties
      bedrooms = 3;
      bathrooms = 2;
      maintenance = 300; // lower maintenance fee
      state = "FL";
    } else {
      // Even in random cases, keep more bias toward our target properties
      bedrooms = Math.random() < 0.8 ? 3 : (Math.floor(Math.random() * 3) + 2); // 80% chance of 3 bedrooms, else 2-4
      bathrooms = Math.random() < 0.8 ? 2 : (Math.floor(Math.random() * 2) + 1.5); // 80% chance of 2 bathrooms, else 1.5-2.5
      maintenance = Math.floor(Math.random() * 500) + 200; // Favor lower maintenance
      // 80% chance to pick Florida (increased from 50%)
      state = Math.random() < 0.8 ? "FL" : undefined;
    }
  } else {
    // HIGH profile: 5+ bed, 4+ bath, luxury homes
    if (Math.random() < (searchBiasPercent / 100)) {
      // Luxury target properties
      bedrooms = 5 + Math.floor(Math.random() * 3); // 5-7 bedrooms
      bathrooms = 4 + Math.floor(Math.random() * 3); // 4-6 bathrooms
      maintenance = 1000 + Math.floor(Math.random() * 1500); // higher maintenance for luxury properties
      state = Math.random() < 0.6 ? "FL" : (Math.random() < 0.5 ? "CA" : "NY"); // Luxury markets
    } else {
      // Even in random cases, still bias toward luxury properties
      bedrooms = Math.random() < 0.8 ? 5 : (Math.floor(Math.random() * 2) + 4); // 80% chance of 5 bedrooms, else 4-5
      bathrooms = Math.random() < 0.8 ? 4 : (Math.floor(Math.random() * 2) + 3.5); // 80% chance of 4 bathrooms, else 3.5-4.5
      maintenance = 800 + Math.floor(Math.random() * 1200); // Higher maintenance
      // Major luxury markets
      const luxuryStates = ["FL", "CA", "NY", "TX", "CO"];
      state = luxuryStates[Math.floor(Math.random() * luxuryStates.length)];
    }
  }

  // Set price range based on property profile
  const priceRangeSelector = Math.random();
  let homePrice;
  
  if (propertyProfile === 'LOW') {
    // LOW profile: $100k-$500k range
    if (priceRangeSelector < 0.7) {
      // 70% of homes in the $200k-$350k sweet spot (increased from 60%)
      homePrice = Math.floor(Math.random() * 150000) + 200000;
    } else if (priceRangeSelector < 0.95) {
      // 25% in the broader $100k-$500k range
      homePrice = Math.floor(Math.random() * 400000) + 100000;
    } else {
      // Just 5% of searches for more expensive properties
      homePrice = Math.floor(Math.random() * 1500000) + 500000;
    }
  } else {
    // HIGH profile: $700k-$10M range
    if (priceRangeSelector < 0.6) {
      // 60% of luxury homes in the $700k-$2M range
      homePrice = Math.floor(Math.random() * 1300000) + 700000;
    } else if (priceRangeSelector < 0.9) {
      // 30% in the $2M-$5M range
      homePrice = Math.floor(Math.random() * 3000000) + 2000000;
    } else {
      // 10% in the ultra-luxury $5M-$10M range
      homePrice = Math.floor(Math.random() * 5000000) + 5000000;
    }
  }
  
  // Square footage based on property profile
  let squareFootage;
  if (propertyProfile === 'LOW') {
    // Standard homes: 500-5000 sq ft
    squareFootage = Math.floor(Math.random() * 4500) + 500;
  } else {
    // Luxury homes: 3000-15000 sq ft
    squareFootage = Math.floor(Math.random() * 12000) + 3000;
  }

  // A set of common search queries based on property profile
  let searchQueries;
  
  if (propertyProfile === 'LOW') {
    // LOW profile: 3 bed, 2 bath Florida homes in our target price range
    searchQueries = [
      // 15 queries for 3 bed, 2 bath Florida homes in our target price range
      "3 bedroom 2 bath home in Orlando Florida under 350k",
      "3 bed 2 bath house with hurricane shutters in Tampa FL not SC",
      "3/2 home with pool in Miami FL under 350k",
      "3 bedroom 2 bathroom single family home in Fort Lauderdale Florida",
      "3 bedroom 2 bath single-story home in Jacksonville FL not South Carolina",
      "affordable 3 bedroom Florida home with low maintenance under 300k",
      "3/2 house in Sarasota Florida under 300k not SC",
      "3 bedroom 2 bath with lanai in Cape Coral Florida",
      "3 bed 2 bath home near schools in Lakeland FL not South Carolina",
      "3 bedroom villa with 2 bathrooms in Naples Florida under 400k",
      "3/2 home with open floor plan in St. Petersburg FL under 350k",
      "family home 3 bed 2 bath in Florida under 400k not SC",
      "3 bedroom 2 bath Florida home with good school district under 350k",
      "3 bed 2 bath home in Florida with low maintenance fees under 300k",
      "3 bedroom 2 bath single family home in Tampa FL area under 400k",
      // 7 more Florida-specific queries that exclude South Carolina explicitly
      "affordable Florida home under 300k not in South Carolina",
      "family home with yard in Florida not SC",
      "home with lanai in Florida not South Carolina under 400k",
      "Florida home with low maintenance near shopping not SC",
      "single family home in Florida under 350k not South Carolina",
      "Florida property not South Carolina under 400k 3 bed 2 bath",
      "Florida house 3/2 layout under 350k not SC",
    ];
  } else {
    // HIGH profile: Luxury properties with 5+ bed, 4+ bath, $700k-$10M
    searchQueries = [
      // Luxury Florida properties
      "5 bedroom 4 bath luxury home in Naples Florida oceanfront",
      "6 bedroom 5 bath estate in Palm Beach FL over 1 million",
      "7 bedroom mansion in Miami Beach waterfront property",
      "5+ bedroom luxury home in Boca Raton with pool and spa",
      "6/5 luxury estate in Jupiter Island Florida with ocean views",
      "Luxury 5 bedroom home in Fisher Island FL with private dock",
      "Exclusive 6 bedroom 6 bath property in Coral Gables with tennis court",
      "Premium 5 bedroom waterfront estate in Key Biscayne",
      "Multi-million dollar 7 bedroom home in Fort Lauderdale with yacht slip",
      "Ultra-luxury 6 bedroom 5 bath beach home in Longboat Key FL",
      // Luxury California properties
      "5 bedroom luxury home in Beverly Hills CA over 5 million",
      "6 bedroom estate in Malibu CA with ocean views",
      "Modern 5 bedroom 5 bath home in La Jolla California",
      "7 bedroom luxury villa in Montecito CA with vineyard",
      "Contemporary 6 bedroom mansion in Newport Beach over 3M",
      // Luxury New York properties
      "5 bedroom luxury penthouse in Manhattan NY",
      "6 bedroom brownstone in Brooklyn Heights NY with garden",
      "Luxurious 5 bedroom 5 bath apartment on Park Avenue",
      "7 bedroom estate in Hamptons NY oceanfront property",
      "Premium 6 bedroom residence in Tribeca New York",
      // Other luxury markets
      "5 bedroom luxury home in Aspen CO with mountain views",
      "Exclusive 6 bedroom property in Vail CO ski-in/ski-out",
      "Luxury 7 bedroom 6 bath ranch in Austin TX over 2M",
      "Premium 5 bedroom estate in Scottsdale AZ with desert views",
      "6 bedroom waterfront mansion in Seattle WA over 4 million"
    ];
  }

  // A set of property features to look for based on property profile
  let featuresList;
  
  if (propertyProfile === 'LOW') {
    // LOW profile: Features for 3 bed, 2 bath affordable homes
    featuresList = [
      // 15 features for 3 bed 2 bath Florida homes
      "3 bedrooms, 2 bathrooms, hurricane impact windows",
      "3/2 with screened-in lanai, ceiling fans",
      "3 bedroom 2 bath with ceramic tile floors, tropical landscaping",
      "3 bed 2 bath with in-ground pool, Florida room",
      "3/2 with attached garage, palm trees",
      "3 bedroom 2 bath with energy efficient AC, sprinkler system",
      "3/2 home with community amenities, tennis courts",
      "3 bedroom 2 bath with open concept kitchen, breakfast nook",
      "3 bed 2 bath with walk-in closet, dual vanities",
      "3/2 single family home with fenced yard",
      "3 bedroom 2 bath with split floor plan, Florida style",
      "3/2 with updated kitchen, granite countertops",
      "3 bedroom 2 bath near schools and shopping",
      "3 bed 2 bath home with good insulation, hurricane shutters",
      "3/2 Florida home with covered patio, outdoor kitchen",
      // 5 more general Florida home features
      "Florida home with low maintenance landscaping",
      "Florida property with HOA under $300/month",
      "Florida home with good school district",
      "Florida property with low property taxes",
      "Florida home with easy commute to city center",
      // 2 general home features
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
    home_price: homePrice,
    square_footage: squareFootage,
    maintenance,
    query,
    features
  };
  if (state) {
    params.state = state;
  }

  // Add geo search parameters only if enabled and (state is set or random chance)
  if (useGeo && (state || Math.random() < 0.7)) {
    let baseLat, baseLng;
    
    if (propertyProfile === 'LOW') {
      // For LOW profile, focus on Central Florida (Orlando area)
      if (state === "FL") {
        baseLat = 28.5383; // Orlando
        baseLng = -81.3792;
      } else {
        // Default to Central Florida
        baseLat = 28.5383;
        baseLng = -81.3792;
        state = "FL";
      }
    } else {
      // For HIGH profile, select luxury markets based on state
      if (state === "FL") {
        // Miami Beach or Palm Beach for Florida
        const isWestCoast = Math.random() < 0.5;
        baseLat = isWestCoast ? 26.1224 : 26.7056; // Miami Beach or Palm Beach
        baseLng = isWestCoast ? -80.1373 : -80.0364;
      } else if (state === "CA") {
        // Beverly Hills or Malibu for California
        const isSouthern = Math.random() < 0.7;
        baseLat = isSouthern ? 34.0736 : 34.0259; // Beverly Hills or Malibu
        baseLng = isSouthern ? -118.4004 : -118.7798;
      } else if (state === "NY") {
        // Manhattan or Hamptons for New York
        const isCity = Math.random() < 0.6;
        baseLat = isCity ? 40.7831 : 40.8832; // Manhattan or Hamptons
        baseLng = isCity ? -73.9712 : -72.3940;
      } else if (state === "CO") {
        // Aspen or Vail for Colorado
        baseLat = Math.random() < 0.5 ? 39.1911 : 39.6433; // Aspen or Vail
        baseLng = Math.random() < 0.5 ? -106.8175 : -106.3781;
      } else if (state === "TX") {
        // Austin luxury neighborhoods
        baseLat = 30.2672;
        baseLng = -97.7431;
      } else {
        // Default to Miami for unspecified states
        baseLat = 25.7617;
        baseLng = -80.1918;
        state = "FL";
      }
    }
    
    // Add some randomness to the coordinates
    const latVariance = propertyProfile === 'LOW' ? 0.25 : 0.1; // Tighter clustering for luxury
    const lngVariance = propertyProfile === 'LOW' ? 0.25 : 0.1;
    const latitude = (baseLat + (Math.random() * latVariance * 2 - latVariance)).toFixed(6);
    const longitude = (baseLng + (Math.random() * lngVariance * 2 - lngVariance)).toFixed(6);
    
    // Set search radius - smaller for luxury properties
    const distance = propertyProfile === 'LOW' ? "350mi" : "100mi";
    
    params.latitude = latitude;
    params.longitude = longitude;
    params.distance = distance;
    if (state) params.state = state;
  }

  // Use v4 template more frequently to ensure we train it properly
  const templateSelector = Math.random();
  if (templateSelector < 0.7) {
    // Heavily favor v3 because this is the most common template
    params.searchTemplateId = 'properties-search-v3';
  } else if (templateSelector < 0.9) {
    // Sometimes use v4 for comparison
    params.searchTemplateId = 'properties-search-v4';
  } else {
    // Occasionally use v1 or v2 for broader training
    params.searchTemplateId = 'properties-search-v2';
  }

  return params;
}

// Step to train and deploy the model using pythonTool (for workflow chaining)
const trainAndDeployModelStep = createStep({
  id: 'train-and-deploy-learn-to-rank-model',
  inputSchema: workflowOutputSchema,
  outputSchema: z.object({
    searchSimResult: workflowOutputSchema,
    trainDeployResult: z.object({
      success: z.boolean(),
      message: z.string(),
      details: z.any().optional(),
    })
  }),
  execute: async ({ inputData, runtimeContext }) => {
    const result = await pythonTool.execute({
      context: {
        scriptCommand: 'train-and-deploy-model',
      },
      runtimeContext
    });
    return {
      searchSimResult: inputData,
      trainDeployResult: {
        success: result.success ?? true,
        message: result.message ?? 'Model training and deployment completed',
        details: result.details,
      }
    };
  },
});

// Step to run the search and engagement simulation
const simulateSearchAutotuneStep = createStep({
  id: 'simulate-search-sessions',
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData, runtimeContext }) => {
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
        const useGeo = inputData.simulateGeoSearch && Math.random() > 0.5;
        const searchParams = generateRandomSearchParams(
          sessionNum,
          searchNum,
          useGeo,
          typeof inputData.searchBiasPercent === 'number' ? inputData.searchBiasPercent : 80,
          inputData.propertyProfile
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
          // Let's create a strong preference for our target properties (3 bed, 2 bath, FL, $100K-$500K)
          let result: SessionResult = sessionResults[0]; // Default initialization
          
          if (sessionResults.length > 1) {
            // Create a scoring system for properties based on our target criteria
            const scoredResults = sessionResults.map(property => {
              let score = 0;
              
              if (inputData.propertyProfile === 'LOW') {
                // LOW profile scoring (3 bed, 2 bath, FL, $100K-$500K)
                
                // Extremely strong preference for 3 bedroom properties
                if (property.bedrooms === 3) score += 100;
                else if (property.bedrooms === 2 || property.bedrooms === 4) score += 10;
                else score -= 50; // Penalize properties with other bedroom counts
                
                // Extremely strong preference for 2 bathroom properties
                if (property.bathrooms === 2) score += 100;
                else if (property.bathrooms === 1.5 || property.bathrooms === 2.5) score += 10;
                else score -= 50; // Penalize properties with other bathroom counts
                
                // Extremely strong preference for Florida properties
                if (property.state === 'FL') score += 150;
                else score -= 100; // Heavily penalize non-Florida properties
                
                // Heavily favor properties in our primary price range ($200K-$350K)
                const price = property.home_price ?? 0;
                if (price >= 200000 && price <= 350000) score += 80;
                else if (price >= 100000 && price <= 500000) score += 40;
                else score -= 75; // Heavily penalize properties outside our price range
                
                // Small bonus for lower maintenance fees
                if ((property.maintenance ?? 1000) < 400) score += 20;
              } else {
                // HIGH profile scoring (5+ bed, 4+ bath, luxury markets, $700K-$10M)
                
                // Strong preference for 5+ bedroom properties
                if ((property.bedrooms ?? 0) >= 5) score += 100;
                else if ((property.bedrooms ?? 0) === 4) score += 20;
                else score -= 80; // Heavily penalize properties with fewer bedrooms
                
                // Strong preference for 4+ bathroom properties
                if ((property.bathrooms ?? 0) >= 4) score += 100;
                else if ((property.bathrooms ?? 0) >= 3) score += 20;
                else score -= 80; // Heavily penalize properties with fewer bathrooms
                
                // Preference for luxury markets
                if (['FL', 'CA', 'NY', 'CO', 'TX'].includes(property.state || '')) score += 80;
                
                // Heavily favor properties in luxury price ranges
                const price = property.home_price ?? 0;
                if (price >= 2000000 && price <= 10000000) score += 100; // Premium luxury
                else if (price >= 700000 && price <= 2000000) score += 70; // Entry luxury
                else if (price > 500000 && price < 700000) score += 20; // Almost luxury
                else score -= 100; // Heavily penalize properties below luxury price range
                
                // Bonus for higher-end properties with higher maintenance/HOA
                if ((property.maintenance ?? 0) > 800) score += 30;
              }
              
              // Add a small random factor to avoid complete determinism
              score += Math.random() * 10;
              
              return { property, score };
            });
            
            // Sort by score descending
            scoredResults.sort((a, b) => b.score - a.score);
            
            // 90% chance to select from top 20% scored properties, else weighted random
            if (Math.random() < 0.9) {
              const cutoff = Math.max(1, Math.floor(scoredResults.length * 0.2));
              const highScorePool = scoredResults.slice(0, cutoff);
              result = highScorePool[Math.floor(Math.random() * highScorePool.length)].property;
            } else {
              // Even for "random" selections, bias toward better scored properties
              // Use weighted random selection
              const totalScore = scoredResults.reduce((sum, item) => sum + item.score, 0);
              let randomPoint = Math.random() * totalScore;
              let selectedResult = false;
              
              for (const scoredResult of scoredResults) {
                randomPoint -= scoredResult.score;
                if (randomPoint <= 0) {
                  result = scoredResult.property;
                  selectedResult = true;
                  break;
                }
              }
              
              // Fallback in case of any issues with the weighted selection
              if (!selectedResult) {
                result = scoredResults[0].property;
              }
            }
          }          // Generate a realistic engagement message based on property profile
          let engagementMessages;
          
          if (inputData.propertyProfile === 'LOW') {
            // LOW profile: 3/2 Florida homes under 400k
            engagementMessages = [
              `I'm interested in viewing this 3 bed 2 bath Florida property ${result.id} under 400k`,
              `Can I schedule a viewing for this affordable ${result.title} in Florida? Love the 3/2 layout`,
              `What are the HOA fees for this 3 bedroom Florida property ${result.id}? I'm looking for homes under 350k`,
              `Is this 3 bedroom home in Florida still available? I'm not interested in South Carolina properties`,
              `I'd like more information about this 3/2 in Florida under 400k`,
              `Are there any similar 3 bed 2 bath properties near ${result.title} in Florida, not South Carolina?`,
              `Can you tell me more about the schools near this 3 bedroom Florida home? I'm avoiding South Carolina`,
              `What's the square footage of this 3/2 property in Florida? I'm looking in the 200k-350k range`,
              `Has the price for this 3 bedroom 2 bath Florida home changed recently? My budget is 350k max`,
              `I'd like to make an offer on this 3/2 Florida property, not interested in South Carolina homes`,
              `Does this 3 bedroom Florida home have hurricane shutters? I'm looking for Florida-specific features`,
              `What are the property taxes on this 3/2 home in Florida? Looking for something affordable`,
              `How old is the AC unit in this Florida 3 bedroom? I want a Florida home, not South Carolina`,
              `Is this 3 bed 2 bath Florida home in a flood zone? I'm specifically looking in Florida`,
              `Are there any pending special assessments on this 3/2 Florida property? My max budget is 400k`
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
          const engagementToolInput = {
            userId,
            sessionId,
            userMessage: engagementMessages[messageIndex],
            position: result.position,
            documentId: result.id,
            lastSearchResults: sessionResults,
            // Provide query context for logging schema
            queryText: result.title, // Use property title as query.text for engagement
            queryTemplateId: 'properties-search-v4', // Favor v4 template for engagements to ensure it gets trained
            queryResultCount: sessionResults.length
          };

          // Log engagement for observability with detailed information about property attributes
          console.log(`Engagement: User ${userId}, Document ${result.id}, Position ${result.position}, Template: ${engagementToolInput.queryTemplateId}, Profile: ${inputData.propertyProfile}, State: ${result.state}, Bedrooms: ${result.bedrooms}, Bathrooms: ${result.bathrooms}, Price: ${result.home_price}`);

          // For v4 template, add extra logging to help diagnose issues
          if (engagementToolInput.queryTemplateId === 'properties-search-v4') {
            if (inputData.propertyProfile === 'LOW') {
              console.log(`V4 TEMPLATE ENGAGEMENT: Strongly reinforcing 3 bed, 2 bath Florida home preference for document ${result.id}`);
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
          engagementRate: inputData.engagementRate,
          simulateGeoSearch: inputData.simulateGeoSearch
        }
      }
    };
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
    trainDeployResult: z.object({
      success: z.boolean(),
      message: z.string(),
      details: z.any().optional(),
    })
  }),
})
  .then(simulateSearchAutotuneStep)
  .then(trainAndDeployModelStep)
  .then(createStep({
    id: 'completion-step',
    inputSchema: z.object({
      searchSimResult: workflowOutputSchema,
      trainDeployResult: z.object({
        success: z.boolean(),
        message: z.string(),
        details: z.any().optional(),
      })
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
      searchSimResult: workflowOutputSchema,
      trainDeployResult: z.object({
        success: z.boolean(),
        message: z.string(),
        details: z.any().optional(),
      })
    }),
    execute: async ({ inputData }) => {
      // Surface Python stdout/stderr if available
      let pythonStdout = '';
      let pythonStderr = '';
      if (inputData.trainDeployResult?.details) {
        if (Array.isArray(inputData.trainDeployResult.details.stdout)) {
          pythonStdout = inputData.trainDeployResult.details.stdout.filter(Boolean).join('\n');
        }
        if (Array.isArray(inputData.trainDeployResult.details.stderr)) {
          pythonStderr = inputData.trainDeployResult.details.stderr.filter(Boolean).join('\n');
        }
      }
      let message = 'Search autotune workflow completed successfully.';
      if (pythonStdout || pythonStderr) {
        message += '\n--- Python Output ---';
        if (pythonStdout) message += `\nSTDOUT:\n${pythonStdout}`;
        if (pythonStderr) message += `\nSTDERR:\n${pythonStderr}`;
      }
      return {
        success: Boolean(inputData.searchSimResult?.success) && Boolean(inputData.trainDeployResult?.success),
        message,
        searchSimResult: inputData.searchSimResult,
        trainDeployResult: inputData.trainDeployResult
      };
    }
  }))
  .commit();

export { searchAutotuneWorkflow };
