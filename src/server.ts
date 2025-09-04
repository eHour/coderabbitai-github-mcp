#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { OrchestratorAgent } from './agents/orchestrator.js';
import { MessageBus } from './lib/message-bus.js';
import { StateManager } from './lib/state-manager.js';
import { Logger } from './lib/logger.js';
import { Config } from './types/index.js';
import { loadConfig, validateGitHubToken } from './config/loader.js';

const logger = new Logger('MCP-Server');

class CodeRabbitMCPServer {
  private server: Server;
  private orchestrator: OrchestratorAgent;
  private messageBus: MessageBus;
  private stateManager: StateManager;
  private config: Config;

  private safeStringify(obj: any): string {
    const seen = new WeakSet();
    return JSON.stringify(obj, (_key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular Reference]';
        }
        seen.add(value);
      }
      return value;
    }, 2);
  }

  constructor() {
    this.server = new Server(
      {
        name: 'mcp-coderabbit',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.messageBus = new MessageBus();
    this.stateManager = new StateManager();
    this.config = loadConfig();
    validateGitHubToken(this.config);
    this.orchestrator = new OrchestratorAgent(
      this.messageBus,
      this.stateManager,
      this.config
    );

    this.setupTools();
  }

  private setupTools() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'github_get_pr_meta',
          description: 'Get PR metadata including status and base branch',
          inputSchema: {
            type: 'object',
            properties: {
              repo: { type: 'string', description: 'Repository in format owner/name' },
              prNumber: { type: 'number', description: 'Pull request number' },
            },
            required: ['repo', 'prNumber'],
          },
        },
        {
          name: 'github_list_review_threads',
          description: 'List review threads from a pull request (paginated)',
          inputSchema: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
              prNumber: { type: 'number' },
              onlyUnresolved: { type: 'boolean', default: true },
              page: { type: 'number', default: 1, description: 'Page number (1-indexed)' },
              pageSize: { type: 'number', default: 10, description: 'Number of threads per page (max 50)' },
            },
            required: ['repo', 'prNumber'],
          },
        },
        {
          name: 'github_post_review_comment',
          description: 'Post a comment on a review thread',
          inputSchema: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
              prNumber: { type: 'number' },
              threadId: { type: 'string' },
              body: { type: 'string', description: 'Comment body, must start with @coderabbitai' },
            },
            required: ['repo', 'prNumber', 'threadId', 'body'],
          },
        },
        {
          name: 'github_resolve_thread',
          description: 'Resolve a review thread',
          inputSchema: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
              prNumber: { type: 'number' },
              threadId: { type: 'string' },
            },
            required: ['repo', 'prNumber', 'threadId'],
          },
        },
        {
          name: 'git_checkout_work_branch',
          description: 'Checkout a work branch for applying fixes',
          inputSchema: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
              prNumber: { type: 'number' },
              baseBranch: { type: 'string' },
              newBranch: { type: 'string' },
            },
            required: ['repo', 'prNumber', 'baseBranch', 'newBranch'],
          },
        },
        {
          name: 'code_apply_unified_diff',
          description: 'Apply a unified diff patch to a file',
          inputSchema: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
              prNumber: { type: 'number' },
              filePath: { type: 'string' },
              diffString: { type: 'string' },
            },
            required: ['repo', 'prNumber', 'filePath', 'diffString'],
          },
        },
        {
          name: 'repo_commit_and_push',
          description: 'Commit changes and push to remote',
          inputSchema: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
              prNumber: { type: 'number' },
              message: { type: 'string' },
            },
            required: ['repo', 'prNumber', 'message'],
          },
        },
        {
          name: 'analysis_validate_finding',
          description: 'Validate a CodeRabbit finding',
          inputSchema: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
              prNumber: { type: 'number' },
              snippet: { type: 'string' },
              inferredRule: { type: 'string' },
              conventions: { type: 'string' },
            },
            required: ['repo', 'prNumber', 'snippet', 'inferredRule'],
          },
        },
        {
          name: 'loop_poll_coderabbit_updates',
          description: 'Poll for new CodeRabbit comments since timestamp',
          inputSchema: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
              prNumber: { type: 'number' },
              sinceIso: { type: 'string' },
            },
            required: ['repo', 'prNumber', 'sinceIso'],
          },
        },
        {
          name: 'get_coderabbit_threads',
          description: 'Get unresolved CodeRabbit review threads for external validation (paginated)',
          inputSchema: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
              prNumber: { type: 'number' },
              page: { type: 'number', default: 1, description: 'Page number (1-indexed)' },
              pageSize: { type: 'number', default: 3, description: 'Number of threads per page (default 3, max 50)' },
            },
            required: ['repo', 'prNumber'],
          },
        },
        {
          name: 'apply_validated_fix',
          description: 'Apply a fix that has been validated externally (by Claude)',
          inputSchema: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
              prNumber: { type: 'number' },
              threadId: { type: 'string' },
              filePath: { type: 'string' },
              diffString: { type: 'string', description: 'Unified diff to apply' },
              commitMessage: { type: 'string' },
            },
            required: ['repo', 'prNumber', 'threadId', 'filePath', 'diffString'],
          },
        },
        {
          name: 'get_rate_limit_status',
          description: 'Get current rate limit status and remaining capacity',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'run_orchestrator',
          description: 'Run the orchestrator to process all threads (uses internal heuristics only)',
          inputSchema: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
              prNumber: { type: 'number' },
              maxIterations: { type: 'number', default: 3 },
              dryRun: { type: 'boolean', default: false },
              validationMode: { 
                type: 'string', 
                enum: ['internal', 'external'],
                default: 'internal',
                description: 'internal: use heuristics/LLM, external: return threads for Claude validation'
              },
            },
            required: ['repo', 'prNumber'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      try {
        switch (name) {
          case 'get_coderabbit_threads': {
            try {
              console.error('DEBUG: Calling getUnresolvedThreads with:', { 
                repo: args?.repo, 
                pr: args?.prNumber, 
                page: args?.page, 
                pageSize: args?.pageSize 
              });
              const threads = await this.orchestrator.getUnresolvedThreads(
                args?.repo as string,
                args?.prNumber as number,
                args?.page as number,
                args?.pageSize as number
              );
              console.error('DEBUG: Got threads result:', typeof threads);
              return {
                content: [
                  {
                    type: 'text',
                    text: this.safeStringify(threads),
                  },
                ],
              };
            } catch (error: any) {
              console.error('ERROR in get_coderabbit_threads:');
              console.error('Message:', error.message);
              console.error('Stack trace:', error.stack);
              throw error;
            }
          }
          
          case 'get_rate_limit_status': {
            const status = this.orchestrator.getRateLimitStatus();
            return {
              content: [
                {
                  type: 'text',
                  text: this.safeStringify(status),
                },
              ],
            };
          }
          
          case 'apply_validated_fix': {
            const result = await this.orchestrator.applyValidatedFix(
              args?.repo as string,
              args?.prNumber as number,
              args?.threadId as string,
              args?.filePath as string,
              args?.diffString as string,
              args?.commitMessage as string
            );
            return {
              content: [
                {
                  type: 'text',
                  text: this.safeStringify(result),
                },
              ],
            };
          }
          
          case 'run_orchestrator':
            const result = await this.orchestrator.run(
              args?.repo as string,
              args?.prNumber as number,
              args?.maxIterations as number,
              args?.dryRun as boolean,
              args?.validationMode as 'internal' | 'external'
            );
            return {
              content: [
                {
                  type: 'text',
                  text: this.safeStringify(result),
                },
              ],
            };
            
          default:
            // Delegate to individual tools
            const toolResult = await this.orchestrator.executeTool(name, args);
            return {
              content: [
                {
                  type: 'text',
                  text: this.safeStringify(toolResult),
                },
              ],
            };
        }
      } catch (error) {
        logger.error(`Tool execution failed: ${name}`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('CodeRabbit MCP Server started');
  }
}

// Start server
const server = new CodeRabbitMCPServer();
server.start().catch((error) => {
  logger.error('Failed to start server', error);
  process.exit(1);
});