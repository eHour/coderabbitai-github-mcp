#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { OrchestratorAgent } from './agents/orchestrator.js';
import { MessageBus } from './lib/message-bus.js';
import { StateManager } from './lib/state-manager.js';
import { Logger } from './lib/logger.js';
import { loadConfig } from './config/loader.js';
const logger = new Logger('MCP-Server');
class CodeRabbitMCPServer {
    server;
    orchestrator;
    messageBus;
    stateManager;
    config;
    constructor() {
        this.server = new Server({
            name: 'mcp-coderabbit',
            version: '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.messageBus = new MessageBus();
        this.stateManager = new StateManager();
        this.config = loadConfig();
        this.orchestrator = new OrchestratorAgent(this.messageBus, this.stateManager, this.config);
        this.setupTools();
    }
    setupTools() {
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
                    description: 'List review threads from a pull request',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            repo: { type: 'string' },
                            prNumber: { type: 'number' },
                            onlyUnresolved: { type: 'boolean', default: true },
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
                    name: 'run_orchestrator',
                    description: 'Run the orchestrator to process all threads',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            repo: { type: 'string' },
                            prNumber: { type: 'number' },
                            maxIterations: { type: 'number', default: 3 },
                            dryRun: { type: 'boolean', default: false },
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
                    case 'run_orchestrator':
                        const result = await this.orchestrator.run(args?.repo, args?.prNumber, args?.maxIterations, args?.dryRun);
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(result, null, 2),
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
                                    text: JSON.stringify(toolResult, null, 2),
                                },
                            ],
                        };
                }
            }
            catch (error) {
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
//# sourceMappingURL=server.js.map