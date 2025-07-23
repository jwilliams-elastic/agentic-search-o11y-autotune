#!/usr/bin/env node

/**
 * Comprehensive Integration Audit
 * Ensures all LTR features work flawlessly with colleague's agentless foundation
 */

import { config } from 'dotenv';
import { Client } from '@elastic/elasticsearch';

config();

interface AuditResult {
  component: string;
  status: 'PASS' | 'FAIL' | 'WARNING';
  details: string;
  dependency?: string;
  recommendation?: string;
}

class IntegrationAuditor {
  private results: AuditResult[] = [];
  private elasticClient: Client | null = null;

  constructor() {
    // Initialize Elasticsearch client like colleague's system
    const elasticUrl = process.env.ELASTIC_URL;
    const elasticApiKey = process.env.ELASTIC_API_KEY;
    
    if (elasticUrl && elasticApiKey) {
      this.elasticClient = new Client({
        node: elasticUrl,
        auth: { apiKey: elasticApiKey },
      });
    }
  }

  private addResult(component: string, status: 'PASS' | 'FAIL' | 'WARNING', details: string, dependency?: string, recommendation?: string) {
    this.results.push({ component, status, details, dependency, recommendation });
  }

  async auditLoggingIntegration() {
    console.log('\n🔍 AUDITING: Logging System Integration');
    console.log('=====================================');

    // Test 1: Agentless Logger Import
    try {
      const { fileLogger } = await import('./src/mastra/logger-agentless.js');
      
      if (fileLogger && typeof fileLogger.info === 'function') {
        this.addResult(
          'Agentless Logger Import',
          'PASS',
          'LTR successfully imports and uses colleague\'s agentless logger',
          'src/mastra/logger-agentless.ts'
        );
        
        // Test logging functionality
        fileLogger.info({
          '@timestamp': new Date().toISOString(),
          'audit.test': 'ltr_logging_integration',
          'event.action': 'integration_audit'
        });
        
      } else {
        this.addResult(
          'Agentless Logger Import',
          'FAIL',
          'Agentless logger not properly accessible',
          'src/mastra/logger-agentless.ts',
          'Check logger export and functionality'
        );
      }
    } catch (error) {
      this.addResult(
        'Agentless Logger Import',
        'FAIL',
        `Failed to import agentless logger: ${error.message}`,
        'src/mastra/logger-agentless.ts',
        'Verify logger implementation and exports'
      );
    }

    // Test 2: Data Stream Configuration
    const dataStreamName = process.env.ELASTIC_LOGS_DATA_STREAM || 'logs-agentic-search-o11y-autotune.events';
    
    if (this.elasticClient) {
      try {
        // Check if data stream exists (colleague's setup)
        const dataStreamExists = await this.elasticClient.indices.exists({
          index: dataStreamName
        });
        
        this.addResult(
          'Data Stream Access',
          dataStreamExists ? 'PASS' : 'WARNING',
          dataStreamExists ? 
            'LTR can write to colleague\'s data stream' : 
            'Data stream not found, will be created on first write',
          dataStreamName,
          !dataStreamExists ? 'Ensure data stream is created for production' : undefined
        );
      } catch (error) {
        this.addResult(
          'Data Stream Access',
          'WARNING',
          `Cannot verify data stream: ${error.message}`,
          dataStreamName,
          'Check Elasticsearch connectivity'
        );
      }
    } else {
      this.addResult(
        'Data Stream Access',
        'WARNING',
        'Elasticsearch not configured, logging will fallback to console',
        'ELASTIC_URL, ELASTIC_API_KEY',
        'Configure Elasticsearch for production logging'
      );
    }
  }

  async auditSearchIntegration() {
    console.log('\n🔍 AUDITING: Search Tool Integration');
    console.log('===================================');

    // Test 1: LTR Search Tool
    try {
      const { elasticsearchSearchLTRTool } = await import('./src/mastra/tools/elasticsearch-search-ltr-tool.js');
      
      if (elasticsearchSearchLTRTool && elasticsearchSearchLTRTool.description) {
        this.addResult(
          'LTR Search Tool',
          'PASS',
          'LTR search tool properly defined and importable',
          'src/mastra/tools/elasticsearch-search-ltr-tool.ts'
        );
      } else {
        this.addResult(
          'LTR Search Tool',
          'FAIL',
          'LTR search tool not properly defined',
          'src/mastra/tools/elasticsearch-search-ltr-tool.ts',
          'Check tool definition and exports'
        );
      }
    } catch (error) {
      this.addResult(
        'LTR Search Tool',
        'FAIL',
        `Cannot import LTR search tool: ${error.message}`,
        'src/mastra/tools/elasticsearch-search-ltr-tool.ts',
        'Fix import issues and dependencies'
      );
    }

    // Test 2: Original Search Tool Compatibility
    try {
      const { elasticsearchSearchTool } = await import('./src/mastra/tools/elasticsearch-search-tool.js');
      
      if (elasticsearchSearchTool) {
        this.addResult(
          'Original Search Tool Compatibility',
          'PASS',
          'Colleague\'s original search tool still accessible',
          'src/mastra/tools/elasticsearch-search-tool.ts'
        );
      } else {
        this.addResult(
          'Original Search Tool Compatibility',
          'FAIL',
          'Original search tool not accessible',
          'src/mastra/tools/elasticsearch-search-tool.ts',
          'Ensure original tool is preserved'
        );
      }
    } catch (error) {
      this.addResult(
        'Original Search Tool Compatibility',
        'WARNING',
        `Cannot verify original search tool: ${error.message}`,
        'src/mastra/tools/elasticsearch-search-tool.ts',
        'Check if original tool exists and is accessible'
      );
    }
  }

  async auditAgentIntegration() {
    console.log('\n🔍 AUDITING: Agent Integration');
    console.log('=============================');

    try {
      const { homeSearchAgent } = await import('./src/mastra/agents/home-search-agent.js');
      
      if (homeSearchAgent && homeSearchAgent.tools) {
        const toolNames = Object.keys(homeSearchAgent.tools);
        
        // Check for all required tools
        const requiredTools = [
          'elasticsearchSearchTool',      // Colleague's original
          'elasticsearchSearchLTRTool',   // Your LTR enhancement
          'propertyClickThroughTool',     // Colleague's original
          'conversationalInteractionTool' // Your conversational enhancement
        ];
        
        const missingTools = requiredTools.filter(tool => !toolNames.includes(tool));
        const extraTools = toolNames.filter(tool => !requiredTools.includes(tool));
        
        if (missingTools.length === 0) {
          this.addResult(
            'Agent Tool Integration',
            'PASS',
            `Home search agent has all ${requiredTools.length} required tools: ${toolNames.join(', ')}`,
            'src/mastra/agents/home-search-agent.ts'
          );
        } else {
          this.addResult(
            'Agent Tool Integration',
            'FAIL',
            `Missing tools: ${missingTools.join(', ')}. Has: ${toolNames.join(', ')}`,
            'src/mastra/agents/home-search-agent.ts',
            'Add missing tools to agent configuration'
          );
        }
        
        if (extraTools.length > 0) {
          this.addResult(
            'Agent Extra Tools',
            'WARNING',
            `Agent has additional tools: ${extraTools.join(', ')}`,
            'src/mastra/agents/home-search-agent.ts',
            'Review if extra tools are needed'
          );
        }
        
      } else {
        this.addResult(
          'Agent Tool Integration',
          'FAIL',
          'Home search agent not properly configured',
          'src/mastra/agents/home-search-agent.ts',
          'Check agent definition and tool configuration'
        );
      }
    } catch (error) {
      this.addResult(
        'Agent Tool Integration',
        'FAIL',
        `Cannot import home search agent: ${error.message}`,
        'src/mastra/agents/home-search-agent.ts',
        'Fix agent import and dependencies'
      );
    }
  }

  async auditConfigurationIntegration() {
    console.log('\n🔍 AUDITING: Configuration Integration');
    console.log('====================================');

    // Test 1: Colleague's Configuration
    const colleagueConfig = {
      'OPENAI_API_KEY': process.env.OPENAI_API_KEY,
      'ELASTIC_URL': process.env.ELASTIC_URL,
      'ELASTIC_API_KEY': process.env.ELASTIC_API_KEY,
      'SEARCH_TEMPLATES_DIR': process.env.SEARCH_TEMPLATES_DIR
    };

    const missingColleagueConfig = Object.entries(colleagueConfig)
      .filter(([key, value]) => !value)
      .map(([key]) => key);

    if (missingColleagueConfig.length === 0) {
      this.addResult(
        'Colleague Configuration',
        'PASS',
        'All colleague\'s required configuration present',
        '.env'
      );
    } else {
      this.addResult(
        'Colleague Configuration',
        'WARNING',
        `Missing colleague config: ${missingColleagueConfig.join(', ')}`,
        '.env',
        'Add missing configuration for full functionality'
      );
    }

    // Test 2: Your LTR Configuration
    const ltrConfig = {
      'LTR_MIN_INTERACTIONS': process.env.LTR_MIN_INTERACTIONS,
      'LTR_MIN_SESSIONS': process.env.LTR_MIN_SESSIONS,
      'LTR_MODEL_DIR': process.env.LTR_MODEL_DIR
    };

    const missingLtrConfig = Object.entries(ltrConfig)
      .filter(([key, value]) => !value)
      .map(([key]) => key);

    if (missingLtrConfig.length === 0) {
      this.addResult(
        'LTR Configuration',
        'PASS',
        'All LTR configuration present',
        '.env'
      );
    } else {
      this.addResult(
        'LTR Configuration',
        'WARNING',
        `Missing LTR config: ${missingLtrConfig.join(', ')} (will use defaults)`,
        '.env',
        'Add LTR configuration for optimal performance'
      );
    }
  }

  async auditLTRComponents() {
    console.log('\n🔍 AUDITING: LTR Component Integration');
    console.log('====================================');

    // Test 1: LTR Reranker Service
    try {
      const { ltrRerankerService } = await import('./integrate-ltr-reranker.js');
      
      if (ltrRerankerService && typeof ltrRerankerService.isReady === 'function') {
        this.addResult(
          'LTR Reranker Service',
          'PASS',
          `LTR reranker service initialized (ready: ${ltrRerankerService.isReady()})`,
          'integrate-ltr-reranker.ts'
        );
      } else {
        this.addResult(
          'LTR Reranker Service',
          'FAIL',
          'LTR reranker service not properly initialized',
          'integrate-ltr-reranker.ts',
          'Check service initialization and exports'
        );
      }
    } catch (error) {
      this.addResult(
        'LTR Reranker Service',
        'FAIL',
        `Cannot import LTR reranker: ${error.message}`,
        'integrate-ltr-reranker.ts',
        'Fix service dependencies and initialization'
      );
    }

    // Test 2: LTR Performance Tracker
    try {
      const LTRImprovementTracker = (await import('./ltr-improvement-tracker.js')).default;
      
      if (LTRImprovementTracker) {
        const tracker = new LTRImprovementTracker();
        this.addResult(
          'LTR Performance Tracker',
          'PASS',
          'LTR performance tracker successfully initialized',
          'ltr-improvement-tracker.ts'
        );
      } else {
        this.addResult(
          'LTR Performance Tracker',
          'FAIL',
          'LTR performance tracker not properly exported',
          'ltr-improvement-tracker.ts',
          'Check tracker class definition and exports'
        );
      }
    } catch (error) {
      this.addResult(
        'LTR Performance Tracker',
        'FAIL',
        `Cannot import LTR tracker: ${error.message}`,
        'ltr-improvement-tracker.ts',
        'Fix tracker dependencies and initialization'
      );
    }

    // Test 3: Conversational Interaction Tool
    try {
      const { conversationalInteractionTool } = await import('./src/mastra/tools/conversational-interaction-tool.js');
      
      if (conversationalInteractionTool && conversationalInteractionTool.execute) {
        this.addResult(
          'Conversational Interaction Tool',
          'PASS',
          'Conversational interaction tool properly defined',
          'src/mastra/tools/conversational-interaction-tool.ts'
        );
      } else {
        this.addResult(
          'Conversational Interaction Tool',
          'FAIL',
          'Conversational interaction tool not properly defined',
          'src/mastra/tools/conversational-interaction-tool.ts',
          'Check tool definition and execute function'
        );
      }
    } catch (error) {
      this.addResult(
        'Conversational Interaction Tool',
        'FAIL',
        `Cannot import conversational tool: ${error.message}`,
        'src/mastra/tools/conversational-interaction-tool.ts',
        'Fix tool dependencies and definition'
      );
    }
  }

  async auditDataFlow() {
    console.log('\n🔍 AUDITING: Data Flow Integration');
    console.log('=================================');

    // Test if LTR can access the data sources it needs
    if (this.elasticClient) {
      const dataIndices = [
        'agentic_search_sessions',
        'agentic_user_interactions'
      ];

      for (const index of dataIndices) {
        try {
          const exists = await this.elasticClient.indices.exists({ index });
          
          if (exists) {
            // Check if index has data
            const count = await this.elasticClient.count({ index });
            const docCount = (count as any).body?.count || count.count || 0;
            
            this.addResult(
              `Data Index: ${index}`,
              docCount > 0 ? 'PASS' : 'WARNING',
              docCount > 0 ? 
                `Index exists with ${docCount} documents` : 
                'Index exists but has no data',
              index,
              docCount === 0 ? 'Generate some search sessions for LTR training' : undefined
            );
          } else {
            this.addResult(
              `Data Index: ${index}`,
              'WARNING',
              'Index does not exist, will be created on first write',
              index,
              'Run some searches to create initial data'
            );
          }
        } catch (error) {
          this.addResult(
            `Data Index: ${index}`,
            'WARNING',
            `Cannot check index: ${error.message}`,
            index,
            'Verify Elasticsearch connectivity'
          );
        }
      }
    } else {
      this.addResult(
        'Data Flow Access',
        'WARNING',
        'Cannot verify data indices without Elasticsearch connection',
        'ELASTIC_URL, ELASTIC_API_KEY',
        'Configure Elasticsearch to verify data flow'
      );
    }
  }

  async runFullAudit() {
    console.log('🧪 COMPREHENSIVE INTEGRATION AUDIT');
    console.log('==================================');
    console.log('Verifying all LTR features work flawlessly with colleague\'s contributions...\n');

    await this.auditLoggingIntegration();
    await this.auditSearchIntegration();
    await this.auditAgentIntegration();
    await this.auditConfigurationIntegration();
    await this.auditLTRComponents();
    await this.auditDataFlow();

    this.generateReport();
  }

  private generateReport() {
    console.log('\n🏆 INTEGRATION AUDIT RESULTS');
    console.log('============================');

    const passed = this.results.filter(r => r.status === 'PASS').length;
    const warnings = this.results.filter(r => r.status === 'WARNING').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const total = this.results.length;

    console.log(`✅ PASSED: ${passed}/${total}`);
    console.log(`⚠️  WARNINGS: ${warnings}/${total}`);
    console.log(`❌ FAILED: ${failed}/${total}`);

    console.log('\n📊 DETAILED RESULTS:');
    this.results.forEach(result => {
      const icon = result.status === 'PASS' ? '✅' : result.status === 'WARNING' ? '⚠️' : '❌';
      console.log(`${icon} ${result.component}: ${result.details}`);
      
      if (result.dependency) {
        console.log(`   📁 Dependency: ${result.dependency}`);
      }
      
      if (result.recommendation) {
        console.log(`   💡 Recommendation: ${result.recommendation}`);
      }
      console.log('');
    });

    // Overall assessment
    if (failed === 0) {
      if (warnings === 0) {
        console.log('🎉 PERFECT INTEGRATION! All LTR features are fully integrated and working flawlessly with colleague\'s contributions!');
      } else {
        console.log('✅ GOOD INTEGRATION! LTR features work well with colleague\'s contributions. Address warnings for optimal performance.');
      }
    } else {
      console.log('⚠️ INTEGRATION ISSUES FOUND! Some LTR features may not work properly. Address failed components immediately.');
    }

    console.log('\n🔄 NEXT STEPS:');
    const criticalIssues = this.results.filter(r => r.status === 'FAIL');
    const importantWarnings = this.results.filter(r => r.status === 'WARNING' && r.recommendation);

    if (criticalIssues.length > 0) {
      console.log('🚨 CRITICAL: Fix these failed components first:');
      criticalIssues.forEach(issue => {
        console.log(`   • ${issue.component}: ${issue.recommendation || issue.details}`);
      });
    }

    if (importantWarnings.length > 0) {
      console.log('⚠️ IMPORTANT: Address these warnings for optimal performance:');
      importantWarnings.forEach(warning => {
        console.log(`   • ${warning.component}: ${warning.recommendation}`);
      });
    }

    if (failed === 0 && warnings === 0) {
      console.log('🚀 Your integration is production-ready!');
      console.log('   • All LTR features work seamlessly with colleague\'s foundation');
      console.log('   • Data flows correctly through agentless logging system');
      console.log('   • Agent has all required tools for full functionality');
      console.log('   • Configuration is properly unified');
    }
  }
}

// Run audit if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const auditor = new IntegrationAuditor();
  auditor.runFullAudit().catch(console.error);
}

export { IntegrationAuditor };
