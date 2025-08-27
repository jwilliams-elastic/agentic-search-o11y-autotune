import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { spawn } from "child_process";
import { config } from 'dotenv';
import { expandEnvVars } from '../../utils/env';

config();

const inputSchema = z.object({
  scriptCommand: z.enum(['train-model', 'deploy-model', 'train-and-deploy-model']).describe("Command options for python tool.")
});

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z.record(z.string(), z.any()).optional(),
});

const scriptPaths: Record<string, string> = {
  'train-model': process.env.LTR_PY_SCRIPT ?? '',
  'deploy-model': process.env.LTR_PY_SCRIPT ?? '',
  'train-and-deploy-model': process.env.LTR_PY_SCRIPT ?? ''
};

// Helper to resolve ${PROJECT_HOME} in paths
function resolveProjectHomePath(path: string): string {
  const projectHome = process.env.PROJECT_HOME || process.cwd();
  return path.replace(/\$\{PROJECT_HOME\}/g, projectHome);
}

let currentExecution: Promise<z.infer<typeof outputSchema>> | null = null;

const executePython = async (params: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> => {
  if (currentExecution) {
    return currentExecution; // Wait for the ongoing execution to complete
  }

  currentExecution = new Promise(async (resolve) => {
    try {
      const { scriptCommand } = params;

      let scriptPath = scriptPaths[scriptCommand];
      const resolvedScriptPath = resolveProjectHomePath(scriptPath);

      if (!resolvedScriptPath) {
        throw new Error('Script path is not specified missing .env variable');
      }

      // Resolve LTR_MODEL_DIR as well
      const resolvedEnv = { ...process.env };
      if (resolvedEnv.LTR_MODEL_DIR) {
        resolvedEnv.LTR_MODEL_DIR = resolveProjectHomePath(resolvedEnv.LTR_MODEL_DIR);
      }

      console.log(`params: ${JSON.stringify(params)}`);
      console.log(`[PythonTool] Executing script: ${resolvedScriptPath} with command: ${scriptCommand}`);
      console.log(`[PythonTool] Environment variables: LTR_MODEL_DIR=${resolvedEnv.LTR_MODEL_DIR}`);

      // Instead of passing scriptCommand as an argument, we run it as a Typer command
      const args = ["-u", resolvedScriptPath, scriptCommand]; // -u = unbuffered stdout
      const child = spawn("python", args, {
        env: resolvedEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdoutBuffer = "";
      let stderrBuffer = "";

      child.stdout.on("data", (data) => {
        stdoutBuffer += data.toString();
        process.stdout.write(`[Python stdout] ${data}`);
      });

      child.stderr.on("data", (data) => {
        stderrBuffer += data.toString();
        process.stderr.write(`[Python stderr] ${data}`);
      });

      const startTime = Date.now();
      await new Promise((resolveChild, rejectChild) => {
        child.on("error", rejectChild);
        child.on("close", (code, signal) => {
          const endTime = Date.now();
          if (code === 0) {
            resolveChild(undefined);
            resolve({
              success: true,
              message: "Python script executed successfully",
              details: {
                scriptPath: resolvedScriptPath,
                command: scriptCommand,
                stdout: stdoutBuffer.split("\n"), // Store each line as an array entry
                stderr: stderrBuffer.split("\n"),
                executionTime: `${((endTime - startTime) / 60000).toFixed(2)} minutes`,
              },
            });
          } else {
            rejectChild(new Error(`Python exited code=${code} signal=${signal ?? "none"}`));
          }
        });
      });
    } catch (error: any) {
      resolve({
        success: false,
        message: `Unexpected error: ${error.message}`,
        details: { error: error.message },
      });
    } finally {
      currentExecution = null; // Reset the execution tracker
    }
  });

  return currentExecution;
};

export const pythonTool = createTool({
  id: 'python-tool',
  description: 'Execute data pipeline commands and crew AI commands using Python scripts.',
  inputSchema,
  outputSchema,
  execute: async (context) => {
    return executePython(context.context);
  },
});
