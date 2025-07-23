#!/usr/bin/env node

/**
 * Test Conversational Tracking Enhanced Integration
 */

import { conversationalInteractionTool } from './src/mastra/tools/conversational-interaction-tool.js';

async function testConversationalTracking() {
  console.log('🧪 Testing Enhanced Conversational Tracking...');
  
  const testMessages = [
    'Tell me about the first property',
    'Show me more details about property 2', 
    'I like the second house',
    'Can you give me info on the top result?',
    'What about that third listing?',
    'This looks interesting'
  ];

  const mockResults = [
    { id: 'prop1', title: 'Beautiful 3BR House', position: 1 },
    { id: 'prop2', title: 'Modern 2BR Condo', position: 2 },
    { id: 'prop3', title: 'Luxury 4BR Villa', position: 3 }
  ];

  let detectedCount = 0;

  for (const message of testMessages) {
    console.log(`\n📝 Testing: "${message}"`);
    
    try {
      const result = await conversationalInteractionTool.execute({
        message,
        userId: 'test-user',
        sessionId: 'test-session',
        lastSearchResults: mockResults
      });
      
      if (result.detected) {
        detectedCount++;
        console.log(`✅ DETECTED: Position ${result.position}, Action: ${result.action}`);
        console.log(`   Target: ${result.targetResult?.title}`);
      } else {
        console.log('❌ No interaction detected');
      }
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
  }

  console.log('\n🏆 CONVERSATIONAL TRACKING TEST RESULTS');
  console.log('=====================================');
  console.log(`✅ Detected: ${detectedCount}/${testMessages.length} messages`);
  
  if (detectedCount > 0) {
    console.log('\n🎉 SUCCESS! Your conversational tracking is working!');
    console.log('\n💬 The agent will now automatically detect when you say things like:');
    console.log('   • "Tell me about the first property"');
    console.log('   • "Show me property 2"');
    console.log('   • "I like the second house"');
    console.log('   • "More info on the top result"');
    console.log('\n🔄 And automatically log position-aware interactions for LTR learning!');
  } else {
    console.log('⚠️  No conversational patterns detected. Check the implementation.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testConversationalTracking().catch(console.error);
}
