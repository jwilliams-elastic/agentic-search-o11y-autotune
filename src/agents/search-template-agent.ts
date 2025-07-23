/**
 * Search Template Agent - Dynamically generates and optimizes Elasticsearch search templates
 * Uses AI to create, evaluate, and improve search templates based on query characteristics
 */

import { Client } from '@elastic/elasticsearch';
import { z } from 'zod';
import { logSearchSession, logUserInteraction } from '../mastra/logger.js';

// Types for search template generation
interface SearchTemplateGenerationAttempt {
  attempt_number: number;
  template: any;
  query_analysis: {
    complexity: number;
    intent: string;
    entities: string[];
    query_type: 'simple' | 'complex' | 'geo' | 'filtered' | 'semantic';
  };
  generation_time_ms: number;
  result_count: number;
  quality_score: number;
  issues_found: string[];
  improvements_made: string[];
}

interface SearchTemplateSession {
  session_id: string;
  original_query: string;
  query_params: Record<string, any>;
  attempts: SearchTemplateGenerationAttempt[];
  final_template: any;
  total_attempts: number;
  total_generation_time_ms: number;
  success: boolean;
  template_complexity_score: number;
  agent_confidence: number;
}

export class SearchTemplateAgent {
  private client: Client;
  private templateCache: Map<string, any> = new Map();
  private learningData: SearchTemplateSession[] = [];

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * Generate optimized search template for a query using AI agent
   */
  async generateSearchTemplate(
    query: string,
    queryParams: Record<string, any>,
    context: {
      userId: string;
      sessionId?: string;
      maxAttempts?: number;
      targetResultCount?: number;
    }
  ): Promise<SearchTemplateSession> {
    const sessionId = context.sessionId || `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    
    console.log(`🤖 Search Template Agent: Starting generation for query: "${query}"`);
    
    const session: SearchTemplateSession = {
      session_id: sessionId,
      original_query: query,
      query_params: queryParams,
      attempts: [],
      final_template: null,
      total_attempts: 0,
      total_generation_time_ms: 0,
      success: false,
      template_complexity_score: 0,
      agent_confidence: 0
    };

    // Analyze query first
    const queryAnalysis = this.analyzeQuery(query, queryParams);
    console.log(`📊 Query Analysis:`, queryAnalysis);

    const maxAttempts = context.maxAttempts || 5;
    const targetResultCount = context.targetResultCount || 10;

    // Agent iteration loop
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStart = Date.now();
      
      console.log(`🔄 Attempt ${attempt}/${maxAttempts}: Generating search template...`);
      
      // Generate template based on query analysis and previous attempts
      const template = this.generateTemplateForAttempt(
        query,
        queryParams,
        queryAnalysis,
        session.attempts
      );

      // Test the template
      const testResult = await this.testSearchTemplate(template, queryParams);
      
      const attempt_data: SearchTemplateGenerationAttempt = {
        attempt_number: attempt,
        template,
        query_analysis: queryAnalysis,
        generation_time_ms: Date.now() - attemptStart,
        result_count: testResult.result_count,
        quality_score: testResult.quality_score,
        issues_found: testResult.issues,
        improvements_made: this.identifyImprovements(session.attempts, testResult)
      };

      session.attempts.push(attempt_data);
      session.total_attempts = attempt;
      session.total_generation_time_ms += attempt_data.generation_time_ms;

      console.log(`📈 Attempt ${attempt} Results: ${testResult.result_count} results, quality: ${testResult.quality_score.toFixed(2)}`);

      // Check if template is good enough
      if (testResult.quality_score >= 0.8 && testResult.result_count >= targetResultCount) {
        session.final_template = template;
        session.success = true;
        session.agent_confidence = testResult.quality_score;
        console.log(`✅ Template generation successful after ${attempt} attempts`);
        break;
      }

      // If this is the last attempt, use the best template found
      if (attempt === maxAttempts) {
        const bestAttempt = session.attempts.reduce((best, current) => 
          current.quality_score > best.quality_score ? current : best
        );
        session.final_template = bestAttempt.template;
        session.success = session.attempts.some(a => a.result_count > 0);
        session.agent_confidence = bestAttempt.quality_score;
        console.log(`⚠️  Using best template from ${maxAttempts} attempts`);
      }
    }

    // Calculate template complexity score for LTR training
    session.template_complexity_score = this.calculateTemplateComplexity(session);
    
    // Store learning data
    this.learningData.push(session);
    
    // Log session for LTR training
    await this.logTemplateSession(session, context.userId);
    
    console.log(`🎯 Template Agent Complete: ${session.success ? 'Success' : 'Partial'} in ${Date.now() - startTime}ms`);
    
    return session;
  }

  /**
   * Analyze query to understand intent and complexity
   */
  private analyzeQuery(query: string, queryParams: Record<string, any>): SearchTemplateGenerationAttempt['query_analysis'] {
    const words = query.toLowerCase().split(/\s+/);
    const complexity = this.calculateQueryComplexity(query, queryParams);
    
    // Extract entities (simple keyword extraction)
    const entities = words.filter(word => 
      word.length > 3 && 
      !['the', 'and', 'with', 'for', 'near', 'in', 'at', 'on'].includes(word)
    );

    // Determine query intent
    let intent = 'general';
    if (query.includes('near') || queryParams.latitude || queryParams.longitude) {
      intent = 'location';
    } else if (query.includes('price') || queryParams.price) {
      intent = 'price_sensitive';
    } else if (query.includes('luxury') || query.includes('premium')) {
      intent = 'quality_focused';
    } else if (entities.length > 3) {
      intent = 'specific_requirements';
    }

    // Determine query type
    let query_type: 'simple' | 'complex' | 'geo' | 'filtered' | 'semantic' = 'simple';
    if (queryParams.latitude && queryParams.longitude) {
      query_type = 'geo';
    } else if (Object.keys(queryParams).length > 2) {
      query_type = 'filtered';
    } else if (words.length > 5) {
      query_type = 'complex';
    } else if (entities.length > 2) {
      query_type = 'semantic';
    }

    return {
      complexity,
      intent,
      entities,
      query_type
    };
  }

  /**
   * Calculate query complexity score
   */
  private calculateQueryComplexity(query: string, queryParams: Record<string, any>): number {
    let complexity = 0;
    
    // Base complexity from query length
    complexity += Math.min(query.length / 50, 1) * 0.3;
    
    // Parameter complexity
    complexity += Math.min(Object.keys(queryParams).length / 10, 1) * 0.4;
    
    // Semantic complexity
    const semanticWords = ['luxury', 'modern', 'cozy', 'spacious', 'quiet', 'convenient'];
    const semanticCount = semanticWords.filter(word => query.toLowerCase().includes(word)).length;
    complexity += Math.min(semanticCount / 3, 1) * 0.3;
    
    return Math.min(complexity, 1);
  }

  /**
   * Generate search template based on analysis and previous attempts
   */
  private generateTemplateForAttempt(
    query: string,
    queryParams: Record<string, any>,
    analysis: SearchTemplateGenerationAttempt['query_analysis'],
    previousAttempts: SearchTemplateGenerationAttempt[]
  ): any {
    const template: any = {
      query: {
        bool: {
          must: [],
          should: [],
          filter: []
        }
      }
    };

    // Learn from previous attempts
    const previousIssues = previousAttempts.flatMap(a => a.issues_found);
    const hadTooFewResults = previousIssues.includes('too_few_results');
    const hadTooManyResults = previousIssues.includes('too_many_results');
    const hadLowRelevance = previousIssues.includes('low_relevance');

    // Main query logic based on analysis
    if (analysis.query_type === 'simple') {
      template.query.bool.must.push({
        multi_match: {
          query: query,
          fields: ['title^2', 'description'],
          type: 'best_fields',
          minimum_should_match: hadTooManyResults ? '80%' : '60%'
        }
      });
    } else if (analysis.query_type === 'semantic') {
      template.query.bool.must.push({
        multi_match: {
          query: query,
          fields: ['title^3', 'description^2', 'features'],
          type: 'cross_fields',
          minimum_should_match: hadTooManyResults ? '70%' : '50%'
        }
      });
    } else if (analysis.query_type === 'complex') {
      // Use more sophisticated matching for complex queries
      template.query.bool.must.push({
        bool: {
          should: [
            {
              match_phrase: {
                title: {
                  query: query,
                  boost: 3
                }
              }
            },
            {
              match: {
                title: {
                  query: query,
                  boost: 2,
                  minimum_should_match: hadTooManyResults ? '80%' : '60%'
                }
              }
            },
            {
              match: {
                description: {
                  query: query,
                  boost: 1,
                  minimum_should_match: hadTooManyResults ? '70%' : '50%'
                }
              }
            }
          ],
          minimum_should_match: 1
        }
      });
    }

    // Add filters based on parameters
    if (queryParams.bedrooms) {
      template.query.bool.filter.push({
        term: { bedrooms: queryParams.bedrooms }
      });
    }

    if (queryParams.bathrooms) {
      template.query.bool.filter.push({
        term: { bathrooms: queryParams.bathrooms }
      });
    }

    if (queryParams.price) {
      template.query.bool.filter.push({
        range: {
          price: {
            lte: queryParams.price * (hadTooFewResults ? 1.5 : 1.2)
          }
        }
      });
    }

    // Geographic search
    if (queryParams.latitude && queryParams.longitude) {
      const distance = queryParams.distance || (hadTooFewResults ? '10km' : '5km');
      template.query.bool.filter.push({
        geo_distance: {
          distance,
          location: {
            lat: queryParams.latitude,
            lon: queryParams.longitude
          }
        }
      });
    }

    // Add boost for quality based on previous attempts
    if (hadLowRelevance) {
      template.query.bool.should.push({
        function_score: {
          query: { match_all: {} },
          functions: [
            {
              field_value_factor: {
                field: 'rating',
                factor: 1.5,
                modifier: 'log1p',
                missing: 0
              }
            }
          ]
        }
      });
    }

    return template;
  }

  /**
   * Test search template and evaluate quality
   */
  private async testSearchTemplate(template: any, queryParams: Record<string, any>): Promise<{
    result_count: number;
    quality_score: number;
    issues: string[];
  }> {
    try {
      const response = await this.client.search({
        index: process.env.INDEX_NAME || 'properties',
        body: template,
        size: 50
      });

      const results = response.hits?.hits || [];
      const result_count = results.length;
      const issues: string[] = [];

      // Evaluate result quality
      let quality_score = 0.5; // Base score

      // Result count evaluation
      if (result_count === 0) {
        quality_score = 0.1;
        issues.push('no_results');
      } else if (result_count < 5) {
        quality_score = 0.3;
        issues.push('too_few_results');
      } else if (result_count > 100) {
        quality_score = 0.4;
        issues.push('too_many_results');
      } else {
        quality_score += 0.3; // Good result count
      }

      // Score distribution evaluation
      if (results.length > 1) {
        const scores = results.map(r => r._score || 0);
        const maxScore = Math.max(...scores);
        const minScore = Math.min(...scores);
        const scoreRange = maxScore - minScore;
        
        if (scoreRange > 2) {
          quality_score += 0.2; // Good score discrimination
        } else {
          issues.push('low_relevance');
        }
      }

      return {
        result_count,
        quality_score: Math.min(quality_score, 1),
        issues
      };

    } catch (error) {
      console.error('Error testing search template:', error);
      return {
        result_count: 0,
        quality_score: 0,
        issues: ['search_error']
      };
    }
  }

  /**
   * Identify improvements made from previous attempts
   */
  private identifyImprovements(
    previousAttempts: SearchTemplateGenerationAttempt[],
    currentResult: { result_count: number; quality_score: number; issues: string[] }
  ): string[] {
    const improvements: string[] = [];

    if (previousAttempts.length === 0) {
      return ['initial_generation'];
    }

    const lastAttempt = previousAttempts[previousAttempts.length - 1];
    
    if (currentResult.result_count > lastAttempt.result_count) {
      improvements.push('increased_results');
    }
    
    if (currentResult.quality_score > lastAttempt.quality_score) {
      improvements.push('improved_quality');
    }
    
    if (currentResult.issues.length < lastAttempt.issues_found.length) {
      improvements.push('resolved_issues');
    }

    return improvements;
  }

  /**
   * Calculate template complexity score for LTR training
   */
  private calculateTemplateComplexity(session: SearchTemplateSession): number {
    let complexity = 0;
    
    // Base complexity from attempt count
    complexity += Math.min(session.total_attempts / 10, 1) * 0.4;
    
    // Time-based complexity
    complexity += Math.min(session.total_generation_time_ms / 10000, 1) * 0.3;
    
    // Success rate complexity
    complexity += session.success ? 0.2 : 0.3;
    
    // Query complexity
    complexity += session.attempts[0]?.query_analysis.complexity || 0;
    
    return Math.min(complexity, 1);
  }

  /**
   * Log template session for LTR training
   */
  private async logTemplateSession(session: SearchTemplateSession, userId: string): Promise<void> {
    try {
      // Create a search session entry for LTR training
      const mockResults = [{
        _id: 'template_session',
        _score: session.agent_confidence,
        title: `Template for: ${session.original_query}`,
        content: JSON.stringify(session.final_template),
        template_complexity: session.template_complexity_score,
        generation_attempts: session.total_attempts,
        generation_time_ms: session.total_generation_time_ms,
        agent_success: session.success
      }];

      // Log using enhanced logger
      await logSearchSession({
        userId,
        query: session.original_query,
        searchResults: mockResults,
        totalResults: 1,
        searchTimeMs: session.total_generation_time_ms,
        queryParams: {
          ...session.query_params,
          agent_session: true,
          template_complexity: session.template_complexity_score,
          generation_attempts: session.total_attempts
        }
      });

      console.log(`📊 Template session logged for LTR training: ${session.session_id}`);
    } catch (error) {
      console.error('Error logging template session:', error);
    }
  }

  /**
   * Get learning data for LTR training
   */
  getLearningData(): SearchTemplateSession[] {
    return this.learningData;
  }

  /**
   * Export template generation features for LTR training
   */
  exportLTRFeatures(): Array<{
    query: string;
    features: Record<string, number>;
    relevance_score: number;
  }> {
    return this.learningData.map(session => ({
      query: session.original_query,
      features: {
        // Template generation features
        template_complexity: session.template_complexity_score,
        generation_attempts: session.total_attempts,
        generation_time_ms: session.total_generation_time_ms,
        agent_confidence: session.agent_confidence,
        success_rate: session.success ? 1 : 0,
        
        // Query analysis features
        query_complexity: session.attempts[0]?.query_analysis.complexity || 0,
        query_length: session.original_query.length,
        query_word_count: session.original_query.split(' ').length,
        entity_count: session.attempts[0]?.query_analysis.entities.length || 0,
        
        // Query type features
        is_simple: session.attempts[0]?.query_analysis.query_type === 'simple' ? 1 : 0,
        is_complex: session.attempts[0]?.query_analysis.query_type === 'complex' ? 1 : 0,
        is_geo: session.attempts[0]?.query_analysis.query_type === 'geo' ? 1 : 0,
        is_filtered: session.attempts[0]?.query_analysis.query_type === 'filtered' ? 1 : 0,
        is_semantic: session.attempts[0]?.query_analysis.query_type === 'semantic' ? 1 : 0,
        
        // Parameter features
        param_count: Object.keys(session.query_params).length,
        has_bedrooms: session.query_params.bedrooms ? 1 : 0,
        has_bathrooms: session.query_params.bathrooms ? 1 : 0,
        has_price: session.query_params.price ? 1 : 0,
        has_location: (session.query_params.latitude && session.query_params.longitude) ? 1 : 0,
        
        // Quality features
        avg_quality_score: session.attempts.reduce((sum, a) => sum + a.quality_score, 0) / session.attempts.length,
        max_quality_score: Math.max(...session.attempts.map(a => a.quality_score)),
        final_result_count: session.attempts[session.attempts.length - 1]?.result_count || 0
      },
      relevance_score: session.agent_confidence
    }));
  }
}

export default SearchTemplateAgent;
