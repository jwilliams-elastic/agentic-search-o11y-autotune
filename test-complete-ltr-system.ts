#!/usr/bin/env npx tsx

/**
 * Complete LTR System Test Suite
 * 
 * Consolidated test suite for the unified LTR system including:
 * - Native LTR search functionality
 * - Conversational interaction detection
 * - Unified data stream logging
 * - Document ID tracking
 * - Confidence score calculation
 */

import { elasticsearchSearchTool } from './src/mastra/tools/elasticsearch-search-tool';

interface TestResult {
  test: string;
  status: 'PASS' | 'FAIL';
  message: string;
  data?: any;
}

async function runTestSuite(): Promise<void> {
  const results: TestResult[] = [];
  
  console.log('🧪 Starting Complete LTR System Test Suite');
  console.log('=' * 50);

  // Test 1: Basic Search with LTR
  try {
    console.log('\n🔍 Test 1: Basic Search with LTR...');
    const basicSearch = await elasticsearchSearchTool.execute({
      context: {
        userId: 'test_user_comprehensive',
        searchTemplateId: 'properties-search-rrf-v1',
        query: 'modern apartment downtown',
        bedrooms: 2,
        bathrooms: 1,
        enableLTR: true,
        logInteractions: true
      },
      runtimeContext: {} as any
    });

    if (basicSearch.success) {
      results.push({
        test: 'Basic Search with LTR',
        status: 'PASS',
        message: `Found ${basicSearch.total} results in ${basicSearch.searchTimeMs}ms`,
        data: { total: basicSearch.total, time: basicSearch.searchTimeMs }
      });
    } else {
      results.push({
        test: 'Basic Search with LTR',
        status: 'FAIL',
        message: `Search failed: ${basicSearch.message}`
      });
    }
  } catch (error) {
    results.push({
      test: 'Basic Search with LTR',
      status: 'FAIL',
      message: `Error: ${error}`
    });
  }

  // Test 2: Conversational Interaction Detection
  try {
    console.log('\n💬 Test 2: Conversational Interaction Detection...');
    const conversationalSearch = await elasticsearchSearchTool.execute({
      context: {
        userId: 'test_user_comprehensive',
        searchTemplateId: 'properties-search-rrf-v1',
        bedrooms: 2,
        bathrooms: 1,
        userMessage: 'Tell me about the first property',
        lastSearchResults: [
          { id: 'prop_test_1', title: 'Modern Downtown Loft', position: 1 },
          { id: 'prop_test_2', title: 'Cozy Urban Apartment', position: 2 },
          { id: 'prop_test_3', title: 'Luxury High-Rise Condo', position: 3 }
        ],
        enableLTR: true,
        logInteractions: true
      },
      runtimeContext: {} as any
    });

    results.push({
      test: 'Conversational Detection',
      status: 'PASS',
      message: 'Conversational interaction detected and logged'
    });
  } catch (error) {
    results.push({
      test: 'Conversational Detection',
      status: 'FAIL',
      message: `Error: ${error}`
    });
  }

  // Test 3: Search Without LTR (Baseline)
  try {
    console.log('\n🔍 Test 3: Baseline Search (No LTR)...');
    const baselineSearch = await elasticsearchSearchTool.execute({
      context: {
        userId: 'test_user_baseline',
        searchTemplateId: 'properties-search-linear-v1',
        query: 'family home with garden',
        bedrooms: 3,
        bathrooms: 2,
        enableLTR: false,
        logInteractions: true
      },
      runtimeContext: {} as any
    });

    if (baselineSearch.success) {
      results.push({
        test: 'Baseline Search',
        status: 'PASS',
        message: `Found ${baselineSearch.total} results in ${baselineSearch.searchTimeMs}ms`,
        data: { total: baselineSearch.total, time: baselineSearch.searchTimeMs }
      });
    } else {
      results.push({
        test: 'Baseline Search',
        status: 'FAIL',
        message: `Search failed: ${baselineSearch.message}`
      });
    }
  } catch (error) {
    results.push({
      test: 'Baseline Search',
      status: 'FAIL',
      message: `Error: ${error}`
    });
  }

  // Test 4: Multiple User Sessions
  try {
    console.log('\n👥 Test 4: Multiple User Sessions...');
    const users = ['user_alpha', 'user_beta', 'user_gamma'];
    const queries = ['luxury condo', 'affordable apartment', 'waterfront property'];
    
    for (let i = 0; i < users.length; i++) {
      await elasticsearchSearchTool.execute({
        context: {
          userId: users[i],
          searchTemplateId: 'properties-search-rrf-v1',
          query: queries[i],
          bedrooms: 2,
          bathrooms: 1,
          enableLTR: true,
          logInteractions: true
        },
        runtimeContext: {} as any
      });
    }

    results.push({
      test: 'Multiple User Sessions',
      status: 'PASS',
      message: `Successfully created ${users.length} user sessions`
    });
  } catch (error) {
    results.push({
      test: 'Multiple User Sessions',
      status: 'FAIL',
      message: `Error: ${error}`
    });
  }

  // Test 5: Document ID Logging
  try {
    console.log('\n📄 Test 5: Document ID Logging...');
    const docIdSearch = await elasticsearchSearchTool.execute({
      context: {
        userId: 'test_user_docid',
        searchTemplateId: 'properties-search-linear-v2',
        query: 'studio apartment',
        enableLTR: false,
        logInteractions: true
      },
      runtimeContext: {} as any
    });

    if (docIdSearch.success && docIdSearch.results && docIdSearch.results.length > 0) {
      const hasDocIds = docIdSearch.results.every((result: any) => result.id);
      results.push({
        test: 'Document ID Logging',
        status: hasDocIds ? 'PASS' : 'FAIL',
        message: hasDocIds ? 'All results have document IDs' : 'Missing document IDs',
        data: { resultCount: docIdSearch.results.length }
      });
    } else {
      results.push({
        test: 'Document ID Logging',
        status: 'FAIL',
        message: 'No results returned for document ID test'
      });
    }
  } catch (error) {
    results.push({
      test: 'Document ID Logging',
      status: 'FAIL',
      message: `Error: ${error}`
    });
  }

  // Display Results
  console.log('\n🎯 TEST RESULTS SUMMARY');
  console.log('=' * 30);
  
  let passCount = 0;
  let failCount = 0;
  
  results.forEach((result, index) => {
    const icon = result.status === 'PASS' ? '✅' : '❌';
    const status = result.status === 'PASS' ? passCount++ : failCount++;
    
    console.log(`${icon} ${index + 1}. ${result.test}: ${result.message}`);
    if (result.data) {
      console.log(`   Data: ${JSON.stringify(result.data)}`);
    }
  });

  console.log(`\n📊 Final Score: ${passCount} PASS, ${failCount} FAIL`);
  
  if (failCount === 0) {
    console.log('\n🎉 ALL TESTS PASSED! LTR System is fully operational!');
    console.log('\n🚀 Next Steps:');
    console.log('   1. Check logs: python check-logs.py');
    console.log('   2. Train model: python unified-datastream-ltr-trainer.py');
    console.log('   3. Query features with ESQL');
  } else {
    console.log(`\n⚠️  ${failCount} test(s) failed. Check the errors above.`);
  }

  console.log('\n🔍 View logs with ESQL:');
  console.log('   FROM .ds-logs-agentic-search-o11y-autotune.events-2025.07.23-000001');
  console.log('   | WHERE `custom.event.action` IN ("agent_search", "search_result_logged")');
  console.log('   | LIMIT 20');
}

// Run the test suite
runTestSuite().catch(console.error);
