import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { config } from 'dotenv';
import { spawn } from 'child_process';

config();

const inputSchema = z.object({
  skipTraining: z.boolean().optional().describe('If true, skip model training and only deploy/test existing model'),
  pythonPath: z.string().optional().describe('Path to the Python executable (default: python3)'),
  scriptPath: z.string().optional().describe('Path to the LTR trainer script (default: unified-datastream-ltr-trainer.py)'),
});

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z.record(z.string(), z.any()).optional(),
});


let currentExecution = null;

const executeLTR = async (params) => {
  if (currentExecution) {
    return currentExecution;
  }
  currentExecution = new Promise((resolve) => {
    try {
      const skipTraining = params.skipTraining;
      const pythonPath = params.pythonPath || process.env.LTR_PYTHON_PATH || 'python3';
      const scriptPath = params.scriptPath || process.env.LTR_TRAIN_SCRIPT || 'unified-datastream-ltr-trainer.py';
      const skipFlag = skipTraining ? '--skip-training' : '';
      const args = [scriptPath];
      if (skipFlag) args.push(skipFlag);

      const child = spawn(pythonPath, args, {
        env: process.env,
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdoutBuffer = '';
      let stderrBuffer = '';

      child.stdout.on('data', (data) => {
        stdoutBuffer += data.toString();
        process.stdout.write(`[LTR stdout] ${data}`);
      });
      child.stderr.on('data', (data) => {
        stderrBuffer += data.toString();
        process.stderr.write(`[LTR stderr] ${data}`);
      });

      const startTime = Date.now();
      child.on('error', (error) => {
        resolve({
          success: false,
          message: `LTR training process error: ${error.message}`,
          details: { error: error.message }
        });
      });
      child.on('close', (code, signal) => {
        const endTime = Date.now();
        if (code === 0) {
          resolve({
            success: true,
            message: 'LTR training pipeline executed successfully.',
            details: {
              scriptPath,
              pythonPath,
              skipTraining,
              stdout: stdoutBuffer.split('\n'),
              stderr: stderrBuffer.split('\n'),
              executionTime: `${((endTime - startTime) / 1000).toFixed(2)} seconds`,
            }
          });
        } else {
          resolve({
            success: false,
            message: `LTR training failed with code=${code} signal=${signal ?? 'none'}`,
            details: {
              scriptPath,
              pythonPath,
              skipTraining,
              stdout: stdoutBuffer.split('\n'),
              stderr: stderrBuffer.split('\n'),
              executionTime: `${((endTime - startTime) / 1000).toFixed(2)} seconds`,
            }
          });
        }
        currentExecution = null;
      });
    } catch (error) {
      currentExecution = null;
      resolve({
        success: false,
        message: `Unexpected error: ${error.message}`,
        details: { error: error.message },
      });
    }
  });
  return currentExecution;
};

export const elasticsearchLTRTrainTool = createTool({
  id: 'elasticsearch-ltr-train',
  description: 'Trigger the training (or deployment) of the LTR model using the Python pipeline.',
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    return executeLTR(context);
  },
});
