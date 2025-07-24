#!/usr/bin/env npx tsx

/**
 * Daily LTR Training Scheduler
 * 
 * Simple, reliable daily training that checks data thresholds and trains if ready.
 * Perfect for production use and demo purposes.
 * 
 * Usage:
 *   npx tsx daily-ltr-trainer.ts              # Check and train if ready
 *   npx tsx daily-ltr-trainer.ts --force      # Train regardless of data
 *   npx tsx daily-ltr-trainer.ts --dry-run    # Check only, don't train
 */

import { Client } from '@elastic/elasticsearch';
import { spawn } from 'child_process';
import { config } from 'dotenv';

config();

// Configurable thresholds (same as search tool)
const MIN_SEARCH_EVENTS = 15;
const MIN_INTERACTION_EVENTS = 8;

const client = new Client({
  node: process.env.ELASTIC_URL,
  auth: { apiKey: process.env.ELASTIC_API_KEY! },
});

interface DataCheck {
  searches: number;
  interactions: number;
  ready: boolean;
  message: string;
}

async function checkDataReadiness(): Promise<DataCheck> {
  console.log('🔍 Checking data readiness...');
  
  try {
    const searchQuery = {
      index: 'logs-agentic-search-o11y-autotune.events',
      body: {
        size: 0,
        query: { term: { 'custom.event.action': 'agent_search' } }
      }
    };
    
    const interactionQuery = {
      index: 'logs-agentic-search-o11y-autotune.events',
      body: {
        size: 0,
        query: { term: { 'custom.event.action': 'agent_user_interactions' } }
      }
    };

    const [searchResult, interactionResult] = await Promise.all([
      client.search(searchQuery),
      client.search(interactionQuery)
    ]);

    const searches = (searchResult.hits.total as { value: number }).value;
    const interactions = (interactionResult.hits.total as { value: number }).value;
    const ready = searches >= MIN_SEARCH_EVENTS && interactions >= MIN_INTERACTION_EVENTS;

    const message = ready 
      ? `✅ Ready: ${searches} searches, ${interactions} interactions (thresholds: ${MIN_SEARCH_EVENTS}/${MIN_INTERACTION_EVENTS})`
      : `⏳ Not ready: ${searches}/${MIN_SEARCH_EVENTS} searches, ${interactions}/${MIN_INTERACTION_EVENTS} interactions`;

    return { searches, interactions, ready, message };
    
  } catch (error) {
    throw new Error(`Failed to check data: ${error}`);
  }
}

async function trainModel(): Promise<void> {
  console.log('🚀 Starting LTR model training...');
  
  const training = spawn('python', ['unified-datastream-ltr-trainer.py'], {
    stdio: 'inherit', // Show all output
    cwd: process.cwd()
  });

  return new Promise((resolve, reject) => {
    training.on('close', (code) => {
      if (code === 0) {
        console.log('🎉 Training completed successfully!');
        resolve();
      } else {
        console.log(`❌ Training failed with exit code: ${code}`);
        reject(new Error(`Training failed with code ${code}`));
      }
    });

    training.on('error', (error) => {
      console.log('❌ Training process error:', error);
      reject(error);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');
  
  console.log('📅 Daily LTR Training Scheduler');
  console.log('=====================================');
  console.log(`🕐 Run time: ${new Date().toLocaleString()}`);
  
  try {
    // Check data readiness
    const dataCheck = await checkDataReadiness();
    console.log(`📊 ${dataCheck.message}`);
    
    // Decide whether to train
    if (!dataCheck.ready && !force) {
      console.log('💡 Collect more search data or use --force to train anyway');
      process.exit(0);
    }
    
    if (dryRun) {
      console.log('🔍 Dry run mode: Would train model now');
      process.exit(0);
    }
    
    if (force) {
      console.log('⚡ Force mode: Training regardless of data thresholds');
    }
    
    // Train the model
    await trainModel();
    
    console.log('✅ Daily training complete!');
    
  } catch (error) {
    console.error('❌ Daily training failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
