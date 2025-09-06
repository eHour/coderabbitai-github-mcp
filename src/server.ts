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
import { workflowStateManager } from './lib/workflow-state.js';
import type { Config, WorkflowToolResponse, ReviewThread } from './types/index.js';
import { loadConfig, validateGitHubToken } from './config/loader.js';
import { GitHubAPIAgent } from './agents/github-api.js';

const logger = new Logger('MCP-Server');

class CodeRabbitMCPServer {
  private server: Server;
  private orchestrator: OrchestratorAgent;
  private messageBus: MessageBus;
  private stateManager: StateManager;
  private config: Config;
  private githubAgent: GitHubAPIAgent;

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
    this.githubAgent = new GitHubAPIAgent(
      this.messageBus,
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
          description: 'Apply a unified diff patch to a file (does NOT commit or push - use workflow tools for complete flow)',
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
          description: 'Apply a validated fix (complete flow: patch file, commit, push to remote, and resolve thread)',
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
                description: 'internal: use heuristics only, external: return threads for Claude validation'
              },
            },
            required: ['repo', 'prNumber'],
          },
        },
        // Workflow-aware tools for guided resolution
        {
          name: 'coderabbit_workflow_start',
          description: 'Start the CodeRabbit resolution workflow. Returns first thread with validation instructions.',
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
          name: 'coderabbit_workflow_validate',
          description: 'Record your validation decision for the current thread',
          inputSchema: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
              prNumber: { type: 'number' },
              threadId: { type: 'string' },
              isValid: { type: 'boolean', description: 'Whether the suggestion is valid and should be applied' },
              reason: { type: 'string', description: 'Explanation for the decision' },
            },
            required: ['repo', 'prNumber', 'threadId', 'isValid'],
          },
        },
        {
          name: 'coderabbit_workflow_apply',
          description: 'Apply the validated fix (complete flow: patch file, commit changes, push to remote, and resolve GitHub thread)',
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
          name: 'coderabbit_workflow_challenge',
          description: 'Challenge an invalid suggestion with explanation',
          inputSchema: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
              prNumber: { type: 'number' },
              threadId: { type: 'string' },
              reason: { type: 'string', description: 'Explanation why the suggestion is invalid' },
            },
            required: ['repo', 'prNumber', 'threadId', 'reason'],
          },
        },
        {
          name: 'coderabbit_workflow_status',
          description: 'Get current workflow progress and next steps',
          inputSchema: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
              prNumber: { type: 'number' },
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
          
          case 'run_orchestrator': {
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
          }

          // Workflow-aware tool handlers
          case 'coderabbit_workflow_start': {
            const response = await this.handleWorkflowStart(
              args?.repo as string,
              args?.prNumber as number
            );
            return {
              content: [
                {
                  type: 'text',
                  text: this.safeStringify(response),
                },
              ],
            };
          }

          case 'coderabbit_workflow_validate': {
            const response = await this.handleWorkflowValidate(
              args?.repo as string,
              args?.prNumber as number,
              args?.threadId as string,
              args?.isValid as boolean,
              args?.reason as string
            );
            return {
              content: [
                {
                  type: 'text',
                  text: this.safeStringify(response),
                },
              ],
            };
          }

          case 'coderabbit_workflow_apply': {
            const response = await this.handleWorkflowApply(
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
                  text: this.safeStringify(response),
                },
              ],
            };
          }

          case 'coderabbit_workflow_challenge': {
            const response = await this.handleWorkflowChallenge(
              args?.repo as string,
              args?.prNumber as number,
              args?.threadId as string,
              args?.reason as string
            );
            return {
              content: [
                {
                  type: 'text',
                  text: this.safeStringify(response),
                },
              ],
            };
          }

          case 'coderabbit_workflow_status': {
            const response = await this.handleWorkflowStatus(
              args?.repo as string,
              args?.prNumber as number
            );
            return {
              content: [
                {
                  type: 'text',
                  text: this.safeStringify(response),
                },
              ],
            };
          }
            
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

  // Helper to check if CodeRabbit has acknowledged an error in the thread
  private checkForSelfCorrection(thread: ReviewThread): boolean {
    // Check all comments in the thread for CodeRabbit self-corrections
    if (!thread.comments || thread.comments.length < 2) {
      return false;
    }
    
    // Look for CodeRabbit's follow-up comments acknowledging error
    const coderabbitComments = thread.comments.filter(
      (c: any) => c.author.login === 'coderabbitai[bot]' || c.author.login === 'coderabbitai'
    );
    
    if (coderabbitComments.length < 2) {
      return false;
    }
    
    // Check if later comments contain acknowledgment patterns
    const acknowledgmentPatterns = [
      /you['']?re absolutely (correct|right)/i,
      /you are absolutely (correct|right)/i,
      /i apologize for/i,
      /my (initial|previous) (comment|suggestion) was (incorrect|wrong|inaccurate)/i,
      /thank you for (the correction|pointing this out|clarifying)/i,
      /i was (wrong|incorrect|mistaken)/i,
      /you['']?re (correct|right)[,.]? (this|the|my)/i,
      /i stand corrected/i,
      /my mistake/i,
      /upon (further|closer) (review|inspection)/i,
      /i misunderstood/i,
      /incorrectly (suggested|identified|flagged)/i
    ];
    
    // Check comments after the first one for acknowledgment
    for (let i = 1; i < coderabbitComments.length; i++) {
      const commentBody = coderabbitComments[i].body;
      for (const pattern of acknowledgmentPatterns) {
        if (pattern.test(commentBody)) {
          logger.info(`Found CodeRabbit self-correction in thread ${thread.id}: "${commentBody.substring(0, 100)}..."`);
          return true;
        }
      }
    }
    
    return false;
  }

  // Workflow tool handlers
  private async handleWorkflowStart(
    repo: string,
    prNumber: number
  ): Promise<WorkflowToolResponse> {
    logger.info(`Starting workflow for ${repo}#${prNumber}`);
    
    // Fetch all CodeRabbit threads
    const threadsData = await this.githubAgent.listReviewThreads(repo, prNumber, true);
    const coderabbitThreads = threadsData.threads.filter(
      t => (t.author.login === 'coderabbitai[bot]' || t.author.login === 'coderabbitai') && !t.isResolved
    );
    
    if (coderabbitThreads.length === 0) {
      return {
        data: {
          message: 'No unresolved CodeRabbit threads found',
          total: 0
        },
        workflow: {
          current_step: 'complete',
          instruction: 'All CodeRabbit threads are already resolved or there are none.',
          progress: '0 of 0 threads'
        }
      };
    }
    
    // Check if first thread has CodeRabbit self-correction
    const firstThread = coderabbitThreads[0];
    const hasSelfCorrection = this.checkForSelfCorrection(firstThread);
    
    // Initialize workflow state
    workflowStateManager.create(repo, prNumber, coderabbitThreads);
    
    // If CodeRabbit has self-corrected, include special instruction
    const instruction = hasSelfCorrection
      ? 'CodeRabbit has already acknowledged this suggestion was incorrect. You should resolve this thread immediately.'
      : 'Analyze this CodeRabbit suggestion and determine if it\'s valid and beneficial. The suggestion is for ' + (firstThread.path || 'the PR') + (firstThread.line ? ' at line ' + firstThread.line : '') + '.';
    
    return {
      data: {
        thread: {
          id: firstThread.id,
          path: firstThread.path,
          line: firstThread.line,
          body: firstThread.body,
          createdAt: firstThread.createdAt,
          hasSelfCorrection
        },
        total_threads: coderabbitThreads.length,
        thread_number: 1
      },
      workflow: {
        current_step: hasSelfCorrection ? 'resolve' : 'validate',
        instruction,
        validation_criteria: hasSelfCorrection ? [] : [
          'Is the suggestion technically correct?',
          'Will it improve code quality or fix a real issue?',
          'Could applying this change introduce bugs or break functionality?',
          'Is the suggestion clear and actionable?'
        ],
        next_tool: hasSelfCorrection ? 'github_resolve_thread' : 'coderabbit_workflow_validate',
        next_params: hasSelfCorrection ? {
          repo,
          prNumber,
          threadId: firstThread.id
        } : {
          repo,
          prNumber,
          threadId: firstThread.id
        },
        progress: `1 of ${coderabbitThreads.length} threads`,
        reminder: 'Process threads ONE BY ONE. Always validate before applying any changes.'
      }
    };
  }

  private async handleWorkflowValidate(
    repo: string,
    prNumber: number,
    threadId: string,
    isValid: boolean,
    reason?: string
  ): Promise<WorkflowToolResponse> {
    logger.info(`Validation decision for thread ${threadId}: ${isValid ? 'VALID' : 'INVALID'}`);
    
    // Record the validation decision
    workflowStateManager.recordDecision(repo, prNumber, threadId, isValid, reason);
    
    const state = workflowStateManager.get(repo, prNumber);
    if (!state) {
      throw new Error('Workflow state not found. Please start the workflow first.');
    }
    
    const currentThread = state.threads.find(t => t.id === threadId);
    if (!currentThread) {
      throw new Error('Thread not found in workflow state');
    }
    
    if (isValid) {
      return {
        data: {
          threadId,
          decision: 'valid',
          reason: reason || 'Suggestion is valid and will be applied'
        },
        workflow: {
          current_step: 'apply',
          instruction: `The suggestion has been validated as correct. Now apply the fix by providing the unified diff and commit message.`,
          next_tool: 'coderabbit_workflow_apply',
          next_params: {
            repo,
            prNumber,
            threadId,
            filePath: currentThread.path
          },
          progress: workflowStateManager.getProgress(repo, prNumber).percentComplete + '%',
          reminder: 'Provide a clear commit message and ensure the diff is correct.'
        }
      };
    } else {
      return {
        data: {
          threadId,
          decision: 'invalid',
          reason: reason || 'Suggestion is not valid'
        },
        workflow: {
          current_step: 'challenge',
          instruction: `Challenge this invalid suggestion by explaining why it's not applicable.`,
          next_tool: 'coderabbit_workflow_challenge',
          next_params: {
            repo,
            prNumber,
            threadId,
            reason: reason || 'This suggestion is not applicable'
          },
          progress: workflowStateManager.getProgress(repo, prNumber).percentComplete + '%'
        }
      };
    }
  }

  private async handleWorkflowApply(
    repo: string,
    prNumber: number,
    threadId: string,
    filePath: string,
    diffString: string,
    commitMessage?: string
  ): Promise<WorkflowToolResponse> {
    logger.info(`Applying fix for thread ${threadId}`);
    
    // Apply the fix using orchestrator's apply method
    const applyResult = await this.orchestrator.applyValidatedFix(
      repo,
      prNumber,
      threadId,
      filePath,
      diffString,
      commitMessage || `fix: Apply CodeRabbit suggestion for ${filePath}`
    );
    
    if (!applyResult.success) {
      throw new Error(`Failed to apply fix: ${applyResult.message}`);
    }
    
    // Record application
    workflowStateManager.recordApplication(repo, prNumber, threadId, 'commit-sha');
    
    // Advance to next thread
    const hasMore = workflowStateManager.advance(repo, prNumber);
    const progress = workflowStateManager.getProgress(repo, prNumber);
    
    if (!hasMore) {
      return {
        data: {
          threadId,
          status: 'applied',
          message: applyResult.message
        },
        workflow: {
          current_step: 'complete',
          instruction: `All ${progress.total} CodeRabbit threads have been processed successfully!`,
          progress: `${progress.total} of ${progress.total} threads completed`
        }
      };
    }
    
    // Get next thread
    const nextThread = workflowStateManager.getCurrentThread(repo, prNumber);
    if (!nextThread) {
      throw new Error('Next thread not found');
    }
    
    // Check if next thread has self-correction
    const nextHasSelfCorrection = this.checkForSelfCorrection(nextThread);
    
    return {
      data: {
        threadId,
        status: 'applied',
        message: applyResult.message,
        next_thread: {
          id: nextThread.id,
          path: nextThread.path,
          line: nextThread.line,
          body: nextThread.body,
          hasSelfCorrection: nextHasSelfCorrection
        }
      },
      workflow: {
        current_step: nextHasSelfCorrection ? 'resolve' : 'validate',
        instruction: nextHasSelfCorrection 
          ? `Fix applied successfully. The next thread has a self-correction from CodeRabbit - it should be resolved immediately.`
          : `Fix applied successfully. Now validate the next CodeRabbit suggestion for ${nextThread.path}.`,
        next_tool: nextHasSelfCorrection ? 'github_resolve_thread' : 'coderabbit_workflow_validate',
        next_params: {
          repo,
          prNumber,
          threadId: nextThread.id
        },
        validation_criteria: nextHasSelfCorrection ? [] : [
          'Is the suggestion technically correct?',
          'Will it improve code quality?',
          'Could it introduce bugs?'
        ],
        progress: `${progress.processed + 1} of ${progress.total} threads`,
        reminder: nextHasSelfCorrection 
          ? 'This thread has a CodeRabbit self-correction. Resolve it immediately.'
          : 'Continue processing threads one by one.'
      }
    };
  }

  private async handleWorkflowChallenge(
    repo: string,
    prNumber: number,
    threadId: string,
    reason: string
  ): Promise<WorkflowToolResponse> {
    logger.info(`Challenging thread ${threadId}`);
    
    // Post challenge comment
    await this.githubAgent.postComment(
      repo,
      prNumber,
      threadId,
      `@coderabbitai ${reason}`
    );
    
    // Advance to next thread
    const hasMore = workflowStateManager.advance(repo, prNumber);
    const progress = workflowStateManager.getProgress(repo, prNumber);
    
    if (!hasMore) {
      return {
        data: {
          threadId,
          status: 'challenged',
          reason
        },
        workflow: {
          current_step: 'complete',
          instruction: `All ${progress.total} CodeRabbit threads have been processed!`,
          progress: `${progress.total} of ${progress.total} threads completed`
        }
      };
    }
    
    // Get next thread
    const nextThread = workflowStateManager.getCurrentThread(repo, prNumber);
    if (!nextThread) {
      throw new Error('Next thread not found');
    }
    
    // Check if next thread has self-correction
    const nextHasSelfCorrection = this.checkForSelfCorrection(nextThread);
    
    return {
      data: {
        threadId,
        status: 'challenged',
        reason,
        next_thread: {
          id: nextThread.id,
          path: nextThread.path,
          line: nextThread.line,
          body: nextThread.body,
          hasSelfCorrection: nextHasSelfCorrection
        }
      },
      workflow: {
        current_step: nextHasSelfCorrection ? 'resolve' : 'validate',
        instruction: nextHasSelfCorrection
          ? `Challenge posted. The next thread has a self-correction from CodeRabbit - it should be resolved immediately.`
          : `Challenge posted. Now validate the next CodeRabbit suggestion for ${nextThread.path}.`,
        next_tool: nextHasSelfCorrection ? 'github_resolve_thread' : 'coderabbit_workflow_validate',
        next_params: {
          repo,
          prNumber,
          threadId: nextThread.id
        },
        validation_criteria: nextHasSelfCorrection ? [] : [
          'Is the suggestion technically correct?',
          'Will it improve code quality?',
          'Could it introduce bugs?'
        ],
        progress: `${progress.processed + 1} of ${progress.total} threads`,
        reminder: nextHasSelfCorrection
          ? 'This thread has a CodeRabbit self-correction. Resolve it immediately.'
          : 'Continue processing threads one by one.'
      }
    };
  }

  private async handleWorkflowStatus(
    repo: string,
    prNumber: number
  ): Promise<WorkflowToolResponse> {
    const state = workflowStateManager.get(repo, prNumber);
    const progress = workflowStateManager.getProgress(repo, prNumber);
    
    if (!state) {
      return {
        data: {
          status: 'not_started',
          message: 'Workflow has not been started for this PR'
        },
        workflow: {
          current_step: 'start',
          instruction: 'Start the workflow using coderabbit_workflow_start',
          next_tool: 'coderabbit_workflow_start',
          next_params: { repo, prNumber }
        }
      };
    }
    
    const currentThread = workflowStateManager.getCurrentThread(repo, prNumber);
    
    return {
      data: {
        status: 'in_progress',
        progress,
        current_thread: currentThread ? {
          id: currentThread.id,
          path: currentThread.path,
          line: currentThread.line
        } : null,
        decisions_made: Array.from(state.decisions.entries()).map(([id, decision]) => ({
          threadId: id,
          isValid: decision.isValid,
          applied: decision.fixApplied
        }))
      },
      workflow: {
        current_step: currentThread ? 'validate' : 'complete',
        instruction: currentThread 
          ? `Continue validating thread ${currentThread.id}`
          : 'All threads have been processed',
        next_tool: currentThread ? 'coderabbit_workflow_validate' : undefined,
        next_params: currentThread ? {
          repo,
          prNumber,
          threadId: currentThread.id
        } : undefined,
        progress: `${progress.processed} of ${progress.total} threads (${progress.percentComplete}%)`,
        reminder: 'Process threads one by one, always validate before applying.'
      }
    };
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('CodeRabbit MCP Server started');
  }
}

// Start server
let server: CodeRabbitMCPServer;
try {
  server = new CodeRabbitMCPServer();
} catch (error) {
  logger.error('Failed to initialize server', error);
  process.exit(1);
}
server.start().catch((error) => {
  logger.error('Failed to start server', error);
  process.exit(1);
});