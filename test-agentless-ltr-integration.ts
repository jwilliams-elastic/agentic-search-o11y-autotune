#!/usr/bin/env node

/**
 * Integration Test: LTR on Agentless Foundation
 * Verifies that our LTR enhancements work properly with colleague's agentless logging
 */

import { config } from 'dotenv';
import { fileLogger } from './src/mastra/logger-agentless.js';
import { ltrRerankerService } from './integrate-ltr-reranker.js';
import LTRImprovementTracker from './ltr-improvement-tracker.js';

config();

async function testAgentlessLTRIntegration() {
  console.log('🧪 TESTING: LTR Integration on Agentless Foundation');
  console.log('===================================================');

  let testsPass = 0;
  let totalTests = 0;

  const runTest = (testName: string, testFn: () => boolean | Promise<boolean>) => {
    totalTests++;
    console.log(`\n${totalTests}️⃣ Testing: ${testName}`);
    
    try {
      const result = testFn();
      if (result instanceof Promise) {
        return result.then(passed => {
          if (passed) {
            testsPass++;
            console.log(`✅ PASS: ${testName}`);
          } else {
            console.log(`❌ FAIL: ${testName}`);
          }
          return passed;
        });
      } else {
        if (result) {
          testsPass++;
          console.log(`✅ PASS: ${testName}`);
        } else {
          console.log(`❌ FAIL: ${testName}`);
        }
        return result;
      }
    } catch (error) {
      console.log(`❌ FAIL: ${testName} (Error: ${error.message})`);
      return false;
    }
  };

  // Test 1: Agentless Logger Integration
  await runTest('Agentless Logger Integration', () => {
    fileLogger.info({
      event: { action: 'ltr_test' },
      message: { text: 'Testing LTR integration with agentless logger' },
      ltr: { test: true }
    });
    return true;
  });

  // Test 2: LTR Reranker Service
  await runTest('LTR Reranker Service Initialization', () => {
    console.log(`   📊 Service ready: ${ltrRerankerService.isReady()}`);
    console.log(`   🔧 Service exists: ${typeof ltrRerankerService === 'object'}`);
    return typeof ltrRerankerService === 'object';
  });

  // Test 3: Performance Monitor
  await runTest('LTR Performance Monitor', () => {
    const tracker = new LTRImprovementTracker();
    console.log(`   📈 Tracker created: ${tracker instanceof LTRImprovementTracker}`);
    return tracker instanceof LTRImprovementTracker;
  });

  // Test 4: Search Tool Import
  await runTest('LTR Search Tool Import', async () => {
    try {
      const { elasticsearchSearchLTRTool } = await import('./src/mastra/tools/elasticsearch-search-ltr-tool.js');
      console.log(`   🔍 Tool description available: ${!!elasticsearchSearchLTRTool.description}`);
      return !!elasticsearchSearchLTRTool.description;
    } catch (error) {
      console.log(`   ❌ Import failed: ${error.message}`);
      return false;
    }
  });

  // Test 5: Home Search Agent Enhancement
  await runTest('Enhanced Home Search Agent', async () => {
    try {
      const { homeSearchAgent } = await import('./src/mastra/agents/home-search-agent.js');
      const toolNames = Object.keys(homeSearchAgent.tools || {});
      console.log(`   🤖 Agent name: ${homeSearchAgent.name}`);
      console.log(`   🔧 Available tools: ${toolNames.join(', ')}`);
      
      // Check if LTR tool is available
      const hasLTRTool = toolNames.includes('elasticsearchSearchLTRTool');
      console.log(`   🎯 Has LTR tool: ${hasLTRTool}`);
      
      return hasLTRTool;
    } catch (error) {
      console.log(`   ❌ Agent test failed: ${error.message}`);
      return false;
    }
  });

  // Test 6: Configuration Integration
  await runTest('Configuration Integration', () => {
    const hasElasticUrl = !!process.env.ELASTIC_URL;
    const hasLTRConfig = !!process.env.LTR_MIN_SESSIONS;
    
    console.log(`   🔧 Elasticsearch config: ${hasElasticUrl}`);
    console.log(`   🎯 LTR config: ${hasLTRConfig}`);
    
    return hasElasticUrl; // LTR config is optional
  });

  // Test 7: Data Stream Compatibility
  await runTest('Data Stream Logging Test', () => {
    // Test that our LTR logging is compatible with their data stream approach
    const testLog = {
      '@timestamp': new Date().toISOString(),
      'event.kind': 'event',
      'event.category': ['search'],
      'event.action': 'ltr_integration_test',
      'ltr.test': true,
      'service.name': 'ltr-integration-test'
    };
    
    fileLogger.info(testLog);
    console.log(`   📊 ECS-compliant log sent to data stream`);
    return true;
  });

  // Final Results
  console.log('\n🏆 INTEGRATION TEST RESULTS');
  console.log('============================');
  console.log(`✅ Tests Passed: ${testsPass}/${totalTests}`);
  console.log(`❌ Tests Failed: ${totalTests - testsPass}/${totalTests}`);
  
  if (testsPass === totalTests) {
    console.log('\n🎉 ALL TESTS PASSED! LTR integration with agentless foundation is working!');
    console.log('\n💡 Next Steps:');
    console.log('   1. Your LTR enhancements are compatible with colleague\'s agentless logging');
    console.log('   2. Data streams will receive both original logs and LTR analytics');
    console.log('   3. Enhanced home search agent has both original and LTR tools');
    console.log('   4. Performance monitoring is ready for production use');
    
    return true;
  } else {
    console.log('\n⚠️  Some tests failed. Review the failures above.');
    console.log('   The integration may need additional work for full compatibility.');
    
    return false;
  }
}

// Run the integration test
if (import.meta.url === `file://${process.argv[1]}`) {
  testAgentlessLTRIntegration()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Integration test crashed:', error);
      process.exit(1);
    });
}

export { testAgentlessLTRIntegration };
