#!/usr/bin/env node

import { Command } from 'commander';
import { spawn } from 'child_process';
import * as path from 'path';
import { Logger } from './lib/logger.js';
import { loadConfig, validateGitHubToken } from './config/loader.js';
import { simpleGit } from 'simple-git';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = new Logger('CLI');

const program = new Command();

program
  .name('mcp-coderabbit')
  .description('MCP server for automating CodeRabbit PR review resolution')
  .version('1.0.0');

program
  .command('run')
  .description('Process CodeRabbit review comments for a pull request')
  .requiredOption('--repo <repo>', 'Repository in format owner/name')
  .requiredOption('--pr <number>', 'Pull request number', parseInt)
  .option('--max-iterations <number>', 'Maximum iterations', parseInt, 3)
  .option('--max-workers <number>', 'Maximum parallel analyzers', parseInt, 5)
  .option('--dry-run', 'Print intended actions without executing', false)
  .option('--verbose', 'Enable verbose logging', false)
  .action(async (options) => {
    try {
      // Set up logging
      if (options.verbose) {
        Logger.setLogLevel('debug');
      }
      
      // Set environment variables for configuration
      if (options.dryRun) {
        process.env.DRY_RUN = 'true';
      }
      if (options.maxWorkers) {
        process.env.MAX_ANALYZERS = String(options.maxWorkers);
      }
      
      logger.info('Starting CodeRabbit MCP', {
        repo: options.repo,
        pr: options.pr,
        maxIterations: options.maxIterations,
        dryRun: options.dryRun,
      });

      // Load and validate configuration
      const config = loadConfig();
      validateGitHubToken(config);

      // Pre-flight checks
      await runPreFlightChecks();

      // Start the MCP server with the orchestrator
      const serverPath = path.join(__dirname, 'server.js');
      const serverProcess = spawn('node', [serverPath], {
        stdio: 'pipe',
        env: {
          ...process.env,
          MCP_MODE: 'orchestrator',
        },
      });

      // Send the run command to the server
      const runCommand = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'run_orchestrator',
          arguments: {
            repo: options.repo,
            prNumber: options.pr,
            maxIterations: options.maxIterations,
            dryRun: options.dryRun,
          },
        },
        id: 1,
      };

      serverProcess.stdin?.write(JSON.stringify(runCommand) + '\n');

      // Handle server output
      serverProcess.stdout?.on('data', (data) => {
        const lines = data.toString().split('\n').filter((line: string) => line.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            if (response.id === 1) {
              handleOrchestratorResult(response.result);
              serverProcess.kill();
            }
          } catch {
            // Not JSON, just log it
            console.log(line);
          }
        }
      });

      serverProcess.stderr?.on('data', (data) => {
        console.error('Server error:', data.toString());
      });

      serverProcess.on('exit', (code) => {
        process.exit(code || 0);
      });

    } catch (error) {
      logger.error('Command failed', error);
      process.exit(1);
    }
  });

program
  .command('server')
  .description('Start the MCP server in standalone mode')
  .action(async () => {
    logger.info('Starting MCP server in standalone mode');
    
    const serverPath = path.join(__dirname, 'server.js');
    const serverProcess = spawn('node', [serverPath], {
      stdio: 'inherit',
    });

    serverProcess.on('exit', (code) => {
      process.exit(code || 0);
    });
  });

async function runPreFlightChecks(): Promise<void> {
  logger.info('Running pre-flight checks');
  
  const git = simpleGit();
  
  // Check if we're in a git repository
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error('Not in a git repository');
  }
  
  // Check for clean working directory
  const status = await git.status();
  if (!status.isClean()) {
    logger.warn('Working directory is not clean. Uncommitted changes may be included.');
    
    if (!process.env.DRY_RUN) {
      throw new Error('Working directory must be clean. Commit or stash your changes.');
    }
  }
  
  // Test remote access
  try {
    await git.fetch(['--dry-run']);
    logger.info('Git remote access verified');
  } catch (error) {
    throw new Error('Cannot access git remote. Check your credentials.');
  }
  
  logger.info('Pre-flight checks passed');
}

function handleOrchestratorResult(result: any): void {
  const content = result.content?.[0]?.text;
  if (!content) {
    logger.error('No result from orchestrator');
    return;
  }

  try {
    const data = JSON.parse(content);
    
    logger.info('\n' + '='.repeat(60));
    logger.info('ORCHESTRATION COMPLETE');
    logger.info('='.repeat(60));
    
    if (data.success) {
      logger.info('✅ Success!');
    } else {
      logger.warn('⚠️ Completed with errors');
    }
    
    logger.info(`\n📊 Summary:`);
    logger.info(`  • Processed: ${data.processed} threads`);
    logger.info(`  • Resolved:  ${data.resolved} threads`);
    logger.info(`  • Rejected:  ${data.rejected} threads`);
    logger.info(`  • Need Review: ${data.needsReview} threads`);
    
    if (data.errors && data.errors.length > 0) {
      logger.warn(`\n⚠️ Errors encountered:`);
      for (const error of data.errors) {
        logger.warn(`  • ${error}`);
      }
    }
    
    logger.info('\n' + '='.repeat(60));
  } catch (error) {
    logger.error('Failed to parse result', error);
    console.log(content);
  }
}

program.parse(process.argv);