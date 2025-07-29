#!/usr/bin/env npx tsx

/**
 * Deploy LTR-enabled Search Templates
 * 
 * This script deploys the new search templates that support LTR rescoring.
 */

import { Client } from '@elastic/elasticsearch';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

config();

const ELASTIC_URL = process.env.ELASTIC_URL;
const ELASTIC_API_KEY = process.env.ELASTIC_API_KEY;

if (!ELASTIC_URL || !ELASTIC_API_KEY) {
  console.error('❌ Missing ELASTIC_URL or ELASTIC_API_KEY environment variables');
  process.exit(1);
}

const client = new Client({
  node: ELASTIC_URL,
  auth: { apiKey: ELASTIC_API_KEY },
});

async function deployLTRTemplates() {
  console.log('🚀 Deploying LTR-enabled search templates...\n');

  const templates = [
    {
      id: 'properties-search-adaptive-ltr',
      file: 'properties-search-adaptive-ltr.mustache', 
      description: 'Adaptive LTR template with automatic fallback (RECOMMENDED)'
    }
  ];

  for (const template of templates) {
    try {
      const templatePath = join(process.cwd(), 'search_templates', template.file);
      const templateContent = readFileSync(templatePath, 'utf8');
      
      console.log(`📋 Deploying template: ${template.id}`);
      
      await client.putScript({
        id: template.id,
        body: {
          script: {
            lang: 'mustache',
            source: templateContent
          }
        }
      });
      
      console.log(`✅ Template '${template.id}' deployed successfully`);
      console.log(`   Description: ${template.description}\n`);
      
    } catch (error) {
      console.error(`❌ Failed to deploy template '${template.id}':`, error);
    }
  }
}

async function testConnection() {
  try {
    const info = await client.info();
    console.log(`✅ Connected to Elasticsearch ${info.version?.number}\n`);
    return true;
  } catch (error) {
    console.error('❌ Failed to connect to Elasticsearch:', error);
    return false;
  }
}

async function main() {
  const connected = await testConnection();
  if (!connected) {
    process.exit(1);
  }
  
  await deployLTRTemplates();
  
  console.log('🎉 LTR template deployment complete!');
  console.log('📖 Usage in search tool:');
  console.log('   - Use "properties-search-adaptive-ltr" for smart LTR with automatic fallback');
  console.log('   - Falls back to baseline search when no LTR model exists');
  console.log('   - Automatically enables LTR when model is deployed');
  console.log('\n⚠️  Note: Template works immediately - LTR activates automatically when model is ready');
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
