// src/logger.ts
import { PinoLogger } from "@mastra/loggers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Get the project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

// Create logs directory if it doesn't exist
const logsDir = path.join(projectRoot, 'logs');
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    console.log(`Created logs directory at: ${logsDir}`);
  }
} catch (error) {
  console.error(`Failed to create logs directory: ${error}`);
}

// Create a basic logger that writes to both console and file
export const fileLogger = new PinoLogger({
  name: "Mastra",
  level: "info",
});

// Custom file logging implementation
const logFilePath = path.join(logsDir, 'mastra.log');

// Get hostname for ECS logs
import * as os from 'os';
const hostname = os.hostname();
const processId = process.pid.toString();

// Function to write to log file in ECS format
function writeToLogFile(level: string, message: any) {
  try {
    const timestamp = new Date().toISOString();
    
    // Create ECS-compliant log structure
    const ecsLog: any = {
      "@timestamp": timestamp,
      "log.level": level.toLowerCase(),
      "host": {
        "hostname": hostname
      },
      "process": {
        "pid": processId
      },
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
    
    fs.appendFileSync(logFilePath, JSON.stringify(ecsLog) + '\n');
  } catch (error) {
    console.error(`Failed to write to log file: ${error}`);
  }
}

// Patch console methods to also log to fileLogger
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
  writeToLogFile("info", message);
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
  writeToLogFile("info", message);
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
  writeToLogFile("warn", message);
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
  writeToLogFile("error", message);
  originalConsoleError.apply(console, args);
};