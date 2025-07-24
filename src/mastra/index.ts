
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { weatherWorkflow } from './workflows/weather-workflow';
import { weatherAgent } from './agents/weather-agent';
import { elasticsearchSetupWorkflow } from './workflows/elasticsearch-setup-workflow';
import { homeSearchAgent } from './agents/home-search-agent';
// import { fileLogger } from './logger';
import { logger} from './logger-agentless';

import { elasticsearchSearchTool } from './tools/elasticsearch-search-tool';

//fileLogger.info("Mastra runtime started");
logger.info("Mastra runtime started");

export const mastra = new Mastra({
  workflows: { weatherWorkflow, elasticsearchSetupWorkflow },
  agents: { weatherAgent, homeSearchAgent },
  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});

// Export tools
//export { propertyClickThroughTool, elasticsearchSearchTool };
