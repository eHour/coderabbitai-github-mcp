#!/usr/bin/env node

import { Command } from 'commander';
import { Logger } from './lib/logger.js';
import { loadConfig, validateGitHubToken } from './config/loader.js';

const logger = new Logger('CLI');

const program = new Command();

program
  .name('mcp-coderabbit')
  .description('MCP server for automating CodeRabbit PR review resolution')
  .version('1.0.0');

// Main command: Start MCP server
program
  .command('start', { isDefault: true })
  .description('Start the MCP server')
  .option('--stdio', 'Use stdio transport (default)', true)
  .option('--port <number>', 'Use HTTP transport on specified port')
  .option('--verbose', 'Enable verbose logging', false)
  .action(async (options) => {
    try {
      if (options.verbose) {
        Logger.setLogLevel('debug');
      }

      logger.info('Starting CodeRabbit MCP Server');

      // Load and validate configuration
      const config = loadConfig();
      validateGitHubToken(config);

      // Start the MCP server directly in this process for stdio
      if (options.stdio) {
        logger.info('Using stdio transport');
        // Import and start the server directly
        await import('./server.js');
        // The server will handle stdio communication
      } else if (options.port) {
        logger.info(`Starting HTTP server on port ${options.port}`);
        // TODO: Implement HTTP transport
        throw new Error('HTTP transport not yet implemented');
      }
    } catch (error) {
      logger.error('Failed to start server', error);
      process.exit(1);
    }
  });

// Test command: Direct invocation for testing
program
  .command('test')
  .description('Test the orchestrator directly (for development)')
  .requiredOption('--repo <repo>', 'Repository in format owner/name')
  .requiredOption('--pr <number>', 'Pull request number', parseInt)
  .option('--max-iterations <number>', 'Maximum iterations', parseInt, 3)
  .option('--dry-run', 'Print intended actions without executing', false)
  .option('--verbose', 'Enable verbose logging', false)
  .action(async (options) => {
    try {
      if (options.verbose) {
        Logger.setLogLevel('debug');
      }

      logger.info('Testing orchestrator directly', {
        repo: options.repo,
        pr: options.pr,
        maxIterations: options.maxIterations,
        dryRun: options.dryRun,
      });

      // Load config
      const config = loadConfig();
      validateGitHubToken(config);

      if (options.dryRun) {
        process.env.DRY_RUN = 'true';
      }

      // For testing, we can directly invoke the orchestrator
      const { MessageBus } = await import('./lib/message-bus.js');
      const { StateManager } = await import('./lib/state-manager.js');
      const { OrchestratorAgent } = await import('./agents/orchestrator.js');

      const messageBus = new MessageBus();
      const stateManager = new StateManager();
      const orchestrator = new OrchestratorAgent(messageBus, stateManager, config);

      const result = await orchestrator.run(
        options.repo,
        options.pr,
        options.maxIterations,
        options.dryRun
      );

      logger.info('Test complete', result);
      process.exit(result.success ? 0 : 1);
    } catch (error) {
      logger.error('Test failed', error);
      process.exit(1);
    }
  });

program.parse(process.argv);