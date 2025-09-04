import { ConfigSchema } from './schemas.js';
import { Logger } from '../lib/logger.js';
import * as fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
import { Config } from '../types/index.js';

const logger = new Logger('ConfigLoader');

export function loadConfig(): Config {
  // Load .env file if it exists
  dotenv.config();

  // Start with defaults
  let config: any = {
    parallelism: {
      maxAnalyzers: 5,
      threadTimeout: 30000,
      batchSize: 10,
    },
    validation: {
      autoAccept: [],
      autoReject: [],
    },
    ci: {
      waitTimeout: 600000,
      checkInterval: 10000,
    },
    github: {
      token: process.env.GITHUB_TOKEN || '',
    },
    dry_run: false,
    max_iterations: 3,
  };

  // Try to load from config file
  const configPaths = [
    path.join(process.cwd(), 'coderabbit-mcp.json'),
    path.join(process.cwd(), '.coderabbit-mcp.json'),
    path.join(process.env.HOME || '', '.config', 'coderabbit-mcp.json'),
  ];

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      logger.info(`Loading config from ${configPath}`);
      try {
        const fileContent = fs.readFileSync(configPath, 'utf-8');
        const fileConfig = JSON.parse(fileContent);
        config = { ...config, ...fileConfig };
        break;
      } catch (error) {
        logger.error(`Failed to load config from ${configPath}`, error);
      }
    }
  }

  // Override with environment variables
  if (process.env.GITHUB_TOKEN) {
    config.github.token = process.env.GITHUB_TOKEN;
  }
  if (process.env.GITHUB_OWNER) {
    config.github.owner = process.env.GITHUB_OWNER;
  }
  if (process.env.GITHUB_REPO) {
    config.github.repo = process.env.GITHUB_REPO;
  }
  if (process.env.OPENAI_API_KEY) {
    if (!config.validation.llm) {
      config.validation.llm = {
        provider: 'openai',
        model: 'gpt-4-turbo',
        temperature: 0.2,
        confidenceThreshold: 0.7,
      };
    }
  }
  if (process.env.ANTHROPIC_API_KEY) {
    if (!config.validation.llm) {
      config.validation.llm = {
        provider: 'anthropic',
        model: 'claude-3-opus-20240229',
        temperature: 0.2,
        confidenceThreshold: 0.7,
      };
    }
  }
  if (process.env.DRY_RUN === 'true') {
    config.dry_run = true;
  }
  if (process.env.MAX_ITERATIONS) {
    config.max_iterations = parseInt(process.env.MAX_ITERATIONS, 10);
  }
  if (process.env.MAX_ANALYZERS) {
    config.parallelism.maxAnalyzers = parseInt(process.env.MAX_ANALYZERS, 10);
  }

  // Validate configuration
  try {
    const validated = ConfigSchema.parse(config);
    logger.debug('Configuration validated', { 
      parallelism: validated.parallelism,
      hasLLM: !!validated.validation.llm,
      dryRun: validated.dry_run,
    });
    return validated as Config;
  } catch (error) {
    logger.error('Invalid configuration', error);
    throw new Error(`Configuration validation failed: ${error}`);
  }
}

export function validateGitHubToken(config: Config): void {
  if (!config.github.token) {
    throw new Error(
      'GitHub token is required. Set GITHUB_TOKEN environment variable or configure in coderabbit-mcp.json'
    );
  }
}