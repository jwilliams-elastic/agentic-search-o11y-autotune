// src/mastra/logger-agentless.ts
import { Client } from '@elastic/elasticsearch';
import { PinoLogger } from "@mastra/loggers";
import { config } from 'dotenv';

config();

// Elasticsearch configuration
const elasticUrl = process.env.ELASTIC_URL;
const elasticApiKey = process.env.ELASTIC_API_KEY;
const dataStreamName = process.env.ELASTIC_LOGS_DATA_STREAM || 'logs-agentic-search-o11y-autotune.events';

// Create Elasticsearch client
let esClient: Client | null = null;
if (elasticUrl && elasticApiKey) {
  esClient = new Client({
    node: elasticUrl,
    auth: { apiKey: elasticApiKey },
  });
} else {
  console.warn('Elasticsearch configuration missing. Logger will fall back to console only.');
}

// Create a basic logger for fallback
export const fileLogger = new PinoLogger({
  name: "Mastra",
  level: "info",
});

// Function to write to Elasticsearch data stream in ECS format
async function writeToElasticsearch(level: string, message: any) {
  if (!esClient) {
    // Fallback to console if ES is not configured
    console.log(`[${level.toUpperCase()}]`, message);
    return;
  }

  try {
    const timestamp = new Date().toISOString();
    
    // Create ECS-compliant log structure
    const ecsLog: any = {
      "@timestamp": timestamp,
      "log.level": level.toLowerCase(),
      "service": {
        "name": "Mastra"
      },
      "event": {},
      "ecs": {
        "version": "8.0.0"
      }
    };
    
    // Handle message based on its type
    if (typeof message === 'object' && message !== null) {
      // If the message contains an event object, use it directly
      if (message.event && typeof message.event === 'object') {
        ecsLog.event = { ...message.event };
        delete message.event;
      }
      
      // If message has a message property, map to message.text
      if (message.message) {
        ecsLog.message = { text: message.message };
        delete message.message;
      } else if (message.content) {
        ecsLog.message = { text: message.content };
        delete message.content;
      }
      
      // Add any remaining properties to the custom field
      const remainingProps = Object.keys(message);
      if (remainingProps.length > 0) {
        ecsLog.custom = {};
        for (const key of remainingProps) {
          ecsLog.custom[key] = message[key];
        }
      }
    } else if (typeof message === 'string') {
      ecsLog.message = { text: message };
    }
    
    // Send to Elasticsearch data stream
    await esClient.index({
      index: dataStreamName,
      body: ecsLog
    });
  } catch (error) {
    console.error(`Failed to write to Elasticsearch: ${error}`);
    // Fallback to console logging
    console.log(`[${level.toUpperCase()}]`, message);
  }
}

// Patch console methods to also log to Elasticsearch
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;
const originalConsoleInfo = console.info;

console.log = (...args: any[]) => {
  // Process the args to create a structured message
  let message: any;
  
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
    // If it's a single object, use it directly
    message = args[0];
  } else if (args.length > 0) {
    // For multiple args or non-object args, create a structured message
    message = { content: args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return '[Complex Object]';
        }
      }
      return String(arg);
    }).join(' ') };
  } else {
    message = { content: '' };
  }
  
  fileLogger.info(message);
  writeToElasticsearch("info", message);
  originalConsoleLog.apply(console, args);
};

console.info = (...args: any[]) => {
  // Process the args to create a structured message
  let message: any;
  
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
    // If it's a single object, use it directly
    message = args[0];
  } else if (args.length > 0) {
    // For multiple args or non-object args, create a structured message
    message = { content: args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return '[Complex Object]';
        }
      }
      return String(arg);
    }).join(' ') };
  } else {
    message = { content: '' };
  }
  
  fileLogger.info(message);
  writeToElasticsearch("info", message);
  originalConsoleInfo.apply(console, args);
};

console.warn = (...args: any[]) => {
  // Process the args to create a structured message
  let message: any;
  
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
    // If it's a single object, use it directly
    message = args[0];
  } else if (args.length > 0) {
    // For multiple args or non-object args, create a structured message
    message = { content: args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return '[Complex Object]';
        }
      }
      return String(arg);
    }).join(' ') };
  } else {
    message = { content: '' };
  }
  
  fileLogger.warn(message);
  writeToElasticsearch("warn", message);
  originalConsoleWarn.apply(console, args);
};

console.error = (...args: any[]) => {
  // Process the args to create a structured message
  let message: any;
  
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
    // If it's a single object, use it directly
    message = args[0];
  } else if (args.length > 0) {
    // For multiple args or non-object args, create a structured message
    message = { content: args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return '[Complex Object]';
        }
      }
      return String(arg);
    }).join(' ') };
  } else {
    message = { content: '' };
  }
  
  fileLogger.error(message);
  writeToElasticsearch("error", message);
  originalConsoleError.apply(console, args);
};

// Export utility functions for direct logging
export const logger = {
  info: (message: any) => {
    fileLogger.info(message);
    writeToElasticsearch("info", message);
  },
  warn: (message: any) => {
    fileLogger.warn(message);
    writeToElasticsearch("warn", message);
  },
  error: (message: any) => {
    fileLogger.error(message);
    writeToElasticsearch("error", message);
  },
  debug: (message: any) => {
    fileLogger.debug(message);
    writeToElasticsearch("debug", message);
  }
};

// Export ES client for advanced usage
export { esClient };
