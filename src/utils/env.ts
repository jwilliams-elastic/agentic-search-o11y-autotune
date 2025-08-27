import dotenv from 'dotenv';

// Load .env file
dotenv.config();

export function expandEnvVars(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] || '');
}
