#!/usr/bin/env node

/**
 * LTR Improvement Tracker
 * Comprehensive monitoring and analytics for LTR system performance improvements
 */

import { Client } from '@elastic/elasticsearch';
import { config } from 'dotenv';
import { writeFile } from 'fs/promises';

config();

export class LTRImprovementTracker {
  private client: Client;

  constructor() {
    this.client = new Client({
      node: process.env.ELASTIC_URL || process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
      auth: {
        apiKey: process.env.ELASTIC_API_KEY || process.env.ELASTICSEARCH_API_KEY!
      }
    });
  }

  /**
   * Generate comprehensive LTR performance report
   */
  async generatePerformanceReport(days: number = 7): Promise<any> {
    console.log(`📊 Generating LTR Performance Report (${days} days)`);
    console.log('================================================');

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

    try {
      // 1. Session Analytics
      const sessionAnalytics = await this.getSessionAnalytics(startDate, endDate);
      
      // 2. User Interaction Analytics
      const interactionAnalytics = await this.getInteractionAnalytics(startDate, endDate);
      
      // 3. Position Bias Analysis
      const positionAnalysis = await this.getPositionBiasAnalysis(startDate, endDate);
      
      // 4. Agent Performance Analysis
      const agentAnalysis = await this.getAgentPerformanceAnalysis(startDate, endDate);
      
      // 5. Search Quality Metrics
      const qualityMetrics = await this.getSearchQualityMetrics(startDate, endDate);
      
      // 6. Improvement Trends
      const trends = await this.getImprovementTrends(startDate, endDate);

      const report = {
        period: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          days: days
        },
        session_analytics: sessionAnalytics,
        interaction_analytics: interactionAnalytics,
        position_analysis: positionAnalysis,
        agent_analysis: agentAnalysis,
        quality_metrics: qualityMetrics,
        improvement_trends: trends,
        generated_at: new Date().toISOString()
      };

      // Display report
      this.displayReport(report);
      
      // Save report to file
      await writeFile(
        `ltr-performance-report-${endDate.toISOString().split('T')[0]}.json`,
        JSON.stringify(report, null, 2)
      );

      return report;

    } catch (error) {
      console.error('❌ Failed to generate performance report:', error);
      throw error;
    }
  }

  /**
   * Get session analytics
   */
  private async getSessionAnalytics(startDate: Date, endDate: Date): Promise<any> {
    const response = await this.client.search({
      index: 'agentic_search_sessions',
      body: {
        query: {
          range: {
            timestamp: {
              gte: startDate.toISOString(),
              lte: endDate.toISOString()
            }
          }
        },
        aggs: {
          total_sessions: {
            value_count: { field: 'sessionId.keyword' }
          },
          unique_users: {
            cardinality: { field: 'userId.keyword' }
          },
          avg_search_time: {
            avg: { field: 'searchTimeMs' }
          },
          avg_results_per_session: {
            avg: { field: 'totalResults' }
          },
          agent_driven_sessions: {
            filter: { term: { 'agent_driven': true } }
          },
          sessions_by_day: {
            date_histogram: {
              field: 'timestamp',
              calendar_interval: 'day'
            }
          }
        },
        size: 0
      }
    });

    return {
      total_sessions: response.aggregations.total_sessions.value,
      unique_users: response.aggregations.unique_users.value,
      avg_search_time_ms: Math.round(response.aggregations.avg_search_time.value || 0),
      avg_results_per_session: Math.round(response.aggregations.avg_results_per_session.value || 0),
      agent_driven_sessions: response.aggregations.agent_driven_sessions.doc_count,
      agent_driven_percentage: ((response.aggregations.agent_driven_sessions.doc_count / response.aggregations.total_sessions.value) * 100).toFixed(1),
      daily_sessions: response.aggregations.sessions_by_day.buckets.map((bucket: any) => ({
        date: bucket.key_as_string.split('T')[0],
        count: bucket.doc_count
      }))
    };
  }

  /**
   * Get user interaction analytics
   */
  private async getInteractionAnalytics(startDate: Date, endDate: Date): Promise<any> {
    const response = await this.client.search({
      index: 'agentic_user_interactions',
      body: {
        query: {
          range: {
            timestamp: {
              gte: startDate.toISOString(),
              lte: endDate.toISOString()
            }
          }
        },
        aggs: {
          total_interactions: {
            value_count: { field: 'interactionId.keyword' }
          },
          interaction_types: {
            terms: { field: 'interactionType.keyword' }
          },
          avg_dwell_time: {
            avg: { field: 'dwellTimeMs' }
          },
          avg_position_clicked: {
            avg: { field: 'position' }
          },
          click_through_rate: {
            filter: { term: { interactionType: 'click' } }
          },
          position_distribution: {
            terms: { 
              field: 'position',
              size: 10,
              order: { _key: 'asc' }
            }
          },
          interactions_by_day: {
            date_histogram: {
              field: 'timestamp',
              calendar_interval: 'day'
            }
          }
        },
        size: 0
      }
    });

    const totalInteractions = response.aggregations.total_interactions.value;
    const clickInteractions = response.aggregations.click_through_rate.doc_count;

    return {
      total_interactions: totalInteractions,
      click_through_rate: ((clickInteractions / totalInteractions) * 100).toFixed(2) + '%',
      avg_dwell_time_seconds: Math.round((response.aggregations.avg_dwell_time.value || 0) / 1000),
      avg_position_clicked: (response.aggregations.avg_position_clicked.value || 0).toFixed(1),
      interaction_breakdown: response.aggregations.interaction_types.buckets.map((bucket: any) => ({
        type: bucket.key,
        count: bucket.doc_count,
        percentage: ((bucket.doc_count / totalInteractions) * 100).toFixed(1) + '%'
      })),
      position_clicks: response.aggregations.position_distribution.buckets.map((bucket: any) => ({
        position: bucket.key,
        clicks: bucket.doc_count
      })),
      daily_interactions: response.aggregations.interactions_by_day.buckets.map((bucket: any) => ({
        date: bucket.key_as_string.split('T')[0],
        count: bucket.doc_count
      }))
    };
  }

  /**
   * Analyze position bias trends
   */
  private async getPositionBiasAnalysis(startDate: Date, endDate: Date): Promise<any> {
    const response = await this.client.search({
      index: 'agentic_user_interactions',
      body: {
        query: {
          bool: {
            must: [
              {
                range: {
                  timestamp: {
                    gte: startDate.toISOString(),
                    lte: endDate.toISOString()
                  }
                }
              },
              {
                term: { interactionType: 'click' }
              }
            ]
          }
        },
        aggs: {
          position_ctr: {
            terms: {
              field: 'position',
              size: 20,
              order: { _key: 'asc' }
            }
          }
        },
        size: 0
      }
    });

    // Calculate position bias correction effectiveness
    const positionStats = response.aggregations.position_ctr.buckets.map((bucket: any) => ({
      position: bucket.key,
      clicks: bucket.doc_count,
      expected_bias_factor: 1.0 / Math.log2(bucket.key + 1)
    }));

    return {
      position_click_distribution: positionStats,
      top_3_click_rate: positionStats.slice(0, 3).reduce((sum, pos) => sum + pos.clicks, 0) / positionStats.reduce((sum, pos) => sum + pos.clicks, 0),
      position_bias_correction_needed: positionStats[0]?.clicks > (positionStats[1]?.clicks * 2)
    };
  }

  /**
   * Analyze agent performance metrics
   */
  private async getAgentPerformanceAnalysis(startDate: Date, endDate: Date): Promise<any> {
    const response = await this.client.search({
      index: 'agentic_search_sessions',
      body: {
        query: {
          bool: {
            must: [
              {
                range: {
                  timestamp: {
                    gte: startDate.toISOString(),
                    lte: endDate.toISOString()
                  }
                }
              },
              {
                term: { agent_driven: true }
              }
            ]
          }
        },
        aggs: {
          avg_generation_attempts: {
            avg: { field: 'generation_attempts' }
          },
          avg_generation_time: {
            avg: { field: 'generation_time_ms' }
          },
          avg_agent_confidence: {
            avg: { field: 'agent_confidence' }
          },
          avg_template_complexity: {
            avg: { field: 'template_complexity' }
          },
          success_rate: {
            filter: { term: { success: true } }
          }
        },
        size: 0
      }
    });

    const totalAgentSessions = response.hits.total.value || 1;
    const successfulSessions = response.aggregations.success_rate.doc_count;

    return {
      total_agent_sessions: totalAgentSessions,
      avg_generation_attempts: (response.aggregations.avg_generation_attempts.value || 0).toFixed(1),
      avg_generation_time_ms: Math.round(response.aggregations.avg_generation_time.value || 0),
      avg_agent_confidence: (response.aggregations.avg_agent_confidence.value || 0).toFixed(3),
      avg_template_complexity: (response.aggregations.avg_template_complexity.value || 0).toFixed(2),
      success_rate: ((successfulSessions / totalAgentSessions) * 100).toFixed(1) + '%',
      difficulty_trend: response.aggregations.avg_generation_attempts.value > 5 ? 'increasing' : 'stable'
    };
  }

  /**
   * Calculate search quality metrics
   */
  private async getSearchQualityMetrics(startDate: Date, endDate: Date): Promise<any> {
    // Get recent performance vs baseline
    const recentSessions = await this.client.search({
      index: 'agentic_search_sessions',
      body: {
        query: {
          range: {
            timestamp: {
              gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() // Last 3 days
            }
          }
        },
        aggs: {
          avg_results: { avg: { field: 'totalResults' } },
          avg_search_time: { avg: { field: 'searchTimeMs' } }
        },
        size: 0
      }
    });

    const baselineSessions = await this.client.search({
      index: 'agentic_search_sessions',
      body: {
        query: {
          range: {
            timestamp: {
              gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
              lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
            }
          }
        },
        aggs: {
          avg_results: { avg: { field: 'totalResults' } },
          avg_search_time: { avg: { field: 'searchTimeMs' } }
        },
        size: 0
      }
    });

    const recentAvgResults = recentSessions.aggregations.avg_results.value || 0;
    const baselineAvgResults = baselineSessions.aggregations.avg_results.value || 0;
    const recentAvgTime = recentSessions.aggregations.avg_search_time.value || 0;
    const baselineAvgTime = baselineSessions.aggregations.avg_search_time.value || 0;

    return {
      recent_avg_results: Math.round(recentAvgResults),
      baseline_avg_results: Math.round(baselineAvgResults),
      results_improvement: baselineAvgResults > 0 ? 
        (((recentAvgResults - baselineAvgResults) / baselineAvgResults) * 100).toFixed(1) + '%' : 'N/A',
      recent_avg_search_time_ms: Math.round(recentAvgTime),
      baseline_avg_search_time_ms: Math.round(baselineAvgTime),
      speed_improvement: baselineAvgTime > 0 ? 
        (((baselineAvgTime - recentAvgTime) / baselineAvgTime) * 100).toFixed(1) + '%' : 'N/A'
    };
  }

  /**
   * Track improvement trends over time
   */
  private async getImprovementTrends(startDate: Date, endDate: Date): Promise<any> {
    const response = await this.client.search({
      index: 'agentic_search_sessions',
      body: {
        query: {
          range: {
            timestamp: {
              gte: startDate.toISOString(),
              lte: endDate.toISOString()
            }
          }
        },
        aggs: {
          daily_metrics: {
            date_histogram: {
              field: 'timestamp',
              calendar_interval: 'day'
            },
            aggs: {
              avg_results: { avg: { field: 'totalResults' } },
              avg_search_time: { avg: { field: 'searchTimeMs' } },
              agent_sessions: { filter: { term: { agent_driven: true } } }
            }
          }
        },
        size: 0
      }
    });

    const dailyData = response.aggregations.daily_metrics.buckets.map((bucket: any) => ({
      date: bucket.key_as_string.split('T')[0],
      sessions: bucket.doc_count,
      avg_results: Math.round(bucket.avg_results.value || 0),
      avg_search_time_ms: Math.round(bucket.avg_search_time.value || 0),
      agent_sessions: bucket.agent_sessions.doc_count
    }));

    // Calculate trends
    const calculateTrend = (values: number[]) => {
      if (values.length < 2) return 'insufficient_data';
      const recent = values.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, values.length);
      const earlier = values.slice(0, -3).reduce((a, b) => a + b, 0) / Math.max(1, values.length - 3);
      const change = ((recent - earlier) / earlier) * 100;
      return change > 5 ? 'improving' : change < -5 ? 'declining' : 'stable';
    };

    return {
      daily_data: dailyData,
      trends: {
        search_volume: calculateTrend(dailyData.map(d => d.sessions)),
        result_quality: calculateTrend(dailyData.map(d => d.avg_results)),
        search_speed: calculateTrend(dailyData.map(d => -d.avg_search_time_ms)), // Negative because lower is better
        agent_adoption: calculateTrend(dailyData.map(d => d.agent_sessions))
      }
    };
  }

  /**
   * Display formatted report
   */
  private displayReport(report: any): void {
    console.log('\n📊 LTR PERFORMANCE DASHBOARD');
    console.log('============================');
    
    console.log('\n🔍 SEARCH VOLUME:');
    console.log(`   Total Sessions: ${report.session_analytics.total_sessions}`);
    console.log(`   Unique Users: ${report.session_analytics.unique_users}`);
    console.log(`   Agent-Driven: ${report.session_analytics.agent_driven_sessions} (${report.session_analytics.agent_driven_percentage}%)`);
    
    console.log('\n👆 USER ENGAGEMENT:');
    console.log(`   Total Interactions: ${report.interaction_analytics.total_interactions}`);
    console.log(`   Click-Through Rate: ${report.interaction_analytics.click_through_rate}`);
    console.log(`   Avg Dwell Time: ${report.interaction_analytics.avg_dwell_time_seconds}s`);
    console.log(`   Avg Click Position: ${report.interaction_analytics.avg_position_clicked}`);
    
    console.log('\n🤖 AGENT PERFORMANCE:');
    console.log(`   Success Rate: ${report.agent_analysis.success_rate}`);
    console.log(`   Avg Generation Time: ${report.agent_analysis.avg_generation_time_ms}ms`);
    console.log(`   Avg Confidence: ${report.agent_analysis.avg_agent_confidence}`);
    console.log(`   Template Complexity: ${report.agent_analysis.avg_template_complexity}`);
    
    console.log('\n📈 QUALITY METRICS:');
    console.log(`   Results/Search: ${report.quality_metrics.recent_avg_results} (${report.quality_metrics.results_improvement} vs baseline)`);
    console.log(`   Search Speed: ${report.quality_metrics.recent_avg_search_time_ms}ms (${report.quality_metrics.speed_improvement} vs baseline)`);
    
    console.log('\n📊 IMPROVEMENT TRENDS:');
    Object.entries(report.improvement_trends.trends).forEach(([metric, trend]) => {
      const icon = trend === 'improving' ? '📈' : trend === 'declining' ? '📉' : '➡️';
      console.log(`   ${metric.replace(/_/g, ' ').toUpperCase()}: ${icon} ${trend}`);
    });
    
    console.log('\n💡 RECOMMENDATIONS:');
    this.generateRecommendations(report);
  }

  /**
   * Generate improvement recommendations
   */
  private generateRecommendations(report: any): void {
    const recommendations = [];
    
    // CTR analysis
    const ctrValue = parseFloat(report.interaction_analytics.click_through_rate.replace('%', ''));
    if (ctrValue < 20) {
      recommendations.push('🎯 Low CTR - Consider improving result relevance or presentation');
    }
    
    // Position bias analysis
    if (report.position_analysis.position_bias_correction_needed) {
      recommendations.push('📍 Strong position bias detected - LTR model helping but can be improved');
    }
    
    // Agent performance
    const agentSuccess = parseFloat(report.agent_analysis.success_rate.replace('%', ''));
    if (agentSuccess < 80) {
      recommendations.push('🤖 Agent success rate low - Review template generation logic');
    }
    
    // Speed analysis
    if (report.quality_metrics.recent_avg_search_time_ms > 1000) {
      recommendations.push('⚡ Search speed could be improved - Consider caching or optimization');
    }
    
    // Data volume
    if (report.session_analytics.total_sessions < 100) {
      recommendations.push('📊 Limited training data - Run more search sessions for better LTR performance');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('🎉 System performing well! Continue monitoring for sustained performance');
    }
    
    recommendations.forEach(rec => console.log(`   ${rec}`));
  }

  /**
   * Real-time monitoring mode
   */
  async startRealTimeMonitoring(intervalMinutes: number = 5): Promise<void> {
    console.log(`🔄 Starting real-time LTR monitoring (${intervalMinutes}min intervals)`);
    console.log('Press Ctrl+C to stop monitoring');
    
    setInterval(async () => {
      try {
        const quickReport = await this.generateQuickReport();
        console.log(`\n⏰ ${new Date().toISOString()}`);
        console.log(`Sessions: ${quickReport.sessions} | Interactions: ${quickReport.interactions} | Avg Position: ${quickReport.avgPosition}`);
      } catch (error) {
        console.error('❌ Monitoring error:', error.message);
      }
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Quick performance snapshot
   */
  private async generateQuickReport(): Promise<any> {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const [sessions, interactions] = await Promise.all([
      this.client.count({
        index: 'agentic_search_sessions',
        body: { query: { range: { timestamp: { gte: last24h.toISOString() } } } }
      }),
      this.client.search({
        index: 'agentic_user_interactions',
        body: {
          query: { range: { timestamp: { gte: last24h.toISOString() } } },
          aggs: { avg_position: { avg: { field: 'position' } } },
          size: 0
        }
      })
    ]);
    
    return {
      sessions: sessions.count,
      interactions: interactions.hits.total.value,
      avgPosition: (interactions.aggregations.avg_position.value || 0).toFixed(1)
    };
  }
}

// CLI interface
async function main() {
  const tracker = new LTRImprovementTracker();
  
  const args = process.argv.slice(2);
  const command = args[0] || 'report';
  const days = parseInt(args[1]) || 7;
  
  switch (command) {
    case 'report':
      await tracker.generatePerformanceReport(days);
      break;
    case 'monitor':
      await tracker.startRealTimeMonitoring(parseInt(args[1]) || 5);
      break;
    default:
      console.log('Usage:');
      console.log('  npx tsx ltr-improvement-tracker.ts report [days]    - Generate performance report');
      console.log('  npx tsx ltr-improvement-tracker.ts monitor [mins]   - Start real-time monitoring');
  }
}

// Run CLI if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default LTRImprovementTracker;
