import { MessageBus } from '../lib/message-bus.js';
import { StateManager } from '../lib/state-manager.js';
import { Logger } from '../lib/logger.js';
import { WorkerPool } from '../lib/worker-pool.js';
import { Config, ReviewThread, ValidationResult, AnalysisResult } from '../types/index.js';
import { GitHubAPIAgent } from './github-api.js';
import { ThreadAnalyzerAgent } from './thread-analyzer.js';
import { CodePatcherAgent } from './code-patcher.js';
import { MonitorAgent } from './monitor.js';
import PQueue from 'p-queue';

export class OrchestratorAgent {
  private logger = new Logger('Orchestrator');
  private githubAgent: GitHubAPIAgent;
  private patcherAgent: CodePatcherAgent;
  private monitorAgent: MonitorAgent;
  private analyzerPool: WorkerPool<ThreadAnalyzerAgent>;
  private taskQueue: PQueue;

  constructor(
    private messageBus: MessageBus,
    private stateManager: StateManager,
    config: Config
  ) {
    this.githubAgent = new GitHubAPIAgent(messageBus, config);
    this.patcherAgent = new CodePatcherAgent(messageBus, stateManager, config);
    this.monitorAgent = new MonitorAgent(messageBus, stateManager, config);
    
    // Create analyzer pool
    const analyzers: ThreadAnalyzerAgent[] = [];
    for (let i = 0; i < config.parallelism.maxAnalyzers; i++) {
      analyzers.push(new ThreadAnalyzerAgent(i, messageBus, stateManager, config));
    }
    this.analyzerPool = new WorkerPool(analyzers);
    
    // Task queue for coordinating work
    this.taskQueue = new PQueue({ 
      concurrency: config.parallelism.maxAnalyzers,
      interval: 1000,
      intervalCap: 10, // Rate limiting
    });

    this.setupMessageHandlers();
  }

  private setupMessageHandlers() {
    this.messageBus.subscribe('orchestrator', async (message) => {
      this.logger.debug(`Received message: ${message.type}`);
    });
  }

  async run(
    repo: string,
    prNumber: number,
    maxIterations = 3,
    dryRun = false
  ): Promise<{
    success: boolean;
    processed: number;
    resolved: number;
    rejected: number;
    needsReview: number;
    errors: string[];
  }> {
    this.logger.info(`Starting orchestration for ${repo}#${prNumber}`);
    
    const result = {
      success: true,
      processed: 0,
      resolved: 0,
      rejected: 0,
      needsReview: 0,
      errors: [] as string[],
    };

    try {
      // Pre-flight checks
      const prMeta = await this.githubAgent.getPRMeta(repo, prNumber);
      if (prMeta.isDraft || prMeta.state === 'closed') {
        throw new Error(`PR ${prNumber} is ${prMeta.isDraft ? 'draft' : 'closed'}`);
      }

      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        this.logger.info(`Starting iteration ${iteration} of ${maxIterations}`);
        
        const iterationResult = await this.runIteration(repo, prNumber, dryRun);
        
        result.processed += iterationResult.processed;
        result.resolved += iterationResult.resolved;
        result.rejected += iterationResult.rejected;
        result.needsReview += iterationResult.needsReview;
        result.errors.push(...iterationResult.errors);

        // Check if all threads are resolved
        const unresolvedThreads = await this.githubAgent.listReviewThreads(
          repo,
          prNumber,
          true
        );
        
        const codeRabbitThreads = unresolvedThreads.filter(
          t => t.author.login === 'coderabbitai'
        );

        if (codeRabbitThreads.length === 0) {
          this.logger.info('All CodeRabbit threads resolved');
          break;
        }

        // Poll for updates before next iteration
        if (iteration < maxIterations) {
          this.logger.info('Polling for CodeRabbit updates...');
          await this.monitorAgent.pollForUpdates(repo, prNumber);
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
        }
      }

      // Generate final report
      const stats = await this.stateManager.getStatistics();
      this.logger.info('Orchestration complete', stats);
      
    } catch (error) {
      this.logger.error('Orchestration failed', error);
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));
    }

    return result;
  }

  private async runIteration(
    repo: string,
    prNumber: number,
    dryRun: boolean
  ): Promise<{
    processed: number;
    resolved: number;
    rejected: number;
    needsReview: number;
    errors: string[];
  }> {
    const result = {
      processed: 0,
      resolved: 0,
      rejected: 0,
      needsReview: 0,
      errors: [] as string[],
    };

    try {
      // 1. Fetch all unresolved threads
      const threads = await this.githubAgent.listReviewThreads(repo, prNumber, true);
      const codeRabbitThreads = threads.filter(t => t.author.login === 'coderabbitai');
      
      this.logger.info(`Found ${codeRabbitThreads.length} unresolved CodeRabbit threads`);
      
      if (codeRabbitThreads.length === 0) {
        return result;
      }

      // 2. Mark threads as processing
      await this.stateManager.markThreadsAsProcessing(
        codeRabbitThreads.map(t => t.id)
      );

      // 3. Analyze threads in parallel
      const analysisPromises = codeRabbitThreads.map(thread =>
        this.taskQueue.add(() => this.analyzeThread(thread, repo, prNumber))
      );

      const analyses = await Promise.allSettled(analysisPromises);
      
      // 4. Collect valid fixes
      const validFixes: AnalysisResult[] = [];
      const invalidThreads: AnalysisResult[] = [];
      const needsReviewThreads: AnalysisResult[] = [];
      
      for (const analysis of analyses) {
        result.processed++;
        
        if (analysis.status === 'rejected') {
          result.errors.push(String(analysis.reason));
          continue;
        }
        
        const analysisResult = analysis.value as AnalysisResult;
        
        switch (analysisResult.result) {
          case ValidationResult.VALID:
            validFixes.push(analysisResult);
            break;
          case ValidationResult.INVALID:
            invalidThreads.push(analysisResult);
            result.rejected++;
            break;
          case ValidationResult.NEEDS_REVIEW:
          case ValidationResult.UNPATCHABLE:
            needsReviewThreads.push(analysisResult);
            result.needsReview++;
            break;
        }
      }

      // 5. Apply valid fixes in batch
      if (validFixes.length > 0 && !dryRun) {
        this.logger.info(`Applying ${validFixes.length} valid fixes`);
        
        const patchResults = await this.patcherAgent.applyBatch(
          repo,
          prNumber,
          validFixes.map(f => ({
            threadId: f.threadId,
            filePath: '', // Will be extracted from patch
            patch: f.patch!,
          }))
        );

        if (patchResults.success) {
          // 6. Commit and push
          const commitSha = await this.patcherAgent.commitAndPush(
            repo,
            prNumber,
            `fix: apply ${validFixes.length} CodeRabbit suggestions`
          );

          // 7. Mark threads as pushed
          await this.stateManager.markThreadsAsPushed(
            validFixes.map(f => f.threadId),
            commitSha
          );

          // 8. Wait for CI
          this.logger.info('Waiting for CI checks...');
          const ciResult = await this.monitorAgent.waitForCI(repo, prNumber, commitSha);

          if (ciResult === 'success') {
            // 9. Resolve threads
            for (const fix of validFixes) {
              await this.githubAgent.resolveThread(repo, prNumber, fix.threadId);
              await this.githubAgent.postComment(
                repo,
                prNumber,
                fix.threadId,
                `@coderabbitai Thanks. Applied the fix in commit ${commitSha}. Please recheck this thread.`
              );
              result.resolved++;
            }
          } else {
            // CI failed - revert and notify
            this.logger.warn('CI failed, reverting commit');
            await this.patcherAgent.revertCommit(repo, commitSha);
            
            await this.stateManager.markThreadsAsFailed(
              validFixes.map(f => f.threadId),
              'CI check failed',
              `https://github.com/${repo}/pull/${prNumber}/checks?sha=${commitSha}`
            );

            for (const fix of validFixes) {
              await this.githubAgent.postComment(
                repo,
                prNumber,
                fix.threadId,
                `@coderabbitai I attempted to apply the suggested fix, but it failed CI. I have reverted the change. [View CI run](https://github.com/${repo}/pull/${prNumber}/checks?sha=${commitSha})`
              );
            }
          }
        }
      } else if (dryRun && validFixes.length > 0) {
        this.logger.dryRun('apply fixes', { count: validFixes.length });
        result.resolved = validFixes.length;
      }

      // 10. Handle invalid and needs-review threads
      for (const invalid of invalidThreads) {
        if (!dryRun) {
          await this.githubAgent.postComment(
            repo,
            prNumber,
            invalid.threadId,
            `@coderabbitai Thank you for the suggestion. We believe this is not valid because: ${invalid.reasoning}. Could you point to a failing case if you see one?`
          );
        } else {
          this.logger.dryRun('post invalid comment', { threadId: invalid.threadId });
        }
      }

      for (const needsReview of needsReviewThreads) {
        if (!dryRun) {
          const message = needsReview.result === ValidationResult.UNPATCHABLE
            ? `@coderabbitai I could not apply this suggestion as the patch failed. The surrounding code may have changed. Please provide an updated suggestion.`
            : `@coderabbitai This suggestion requires human review. My analysis confidence is below threshold (${Math.round(needsReview.confidence * 100)}%). Could you clarify the expected behavior?`;
          
          await this.githubAgent.postComment(repo, prNumber, needsReview.threadId, message);
        } else {
          this.logger.dryRun('post needs-review comment', { threadId: needsReview.threadId });
        }
      }

    } catch (error) {
      this.logger.error('Iteration failed', error);
      result.errors.push(error instanceof Error ? error.message : String(error));
    }

    return result;
  }

  private async analyzeThread(
    thread: ReviewThread,
    repo: string,
    prNumber: number
  ): Promise<AnalysisResult> {
    const worker = await this.analyzerPool.acquire();
    try {
      return await worker.analyzeThread(thread, repo, prNumber);
    } finally {
      this.analyzerPool.release(worker);
    }
  }

  async executeTool(name: string, args: any): Promise<any> {
    // Delegate tool execution to appropriate agents
    switch (name) {
      case 'github_get_pr_meta':
        return await this.githubAgent.getPRMeta(args.repo, args.prNumber);
      case 'github_list_review_threads':
        return await this.githubAgent.listReviewThreads(
          args.repo,
          args.prNumber,
          args.onlyUnresolved
        );
      case 'github_post_review_comment':
        return await this.githubAgent.postComment(
          args.repo,
          args.prNumber,
          args.threadId,
          args.body
        );
      case 'github_resolve_thread':
        return await this.githubAgent.resolveThread(
          args.repo,
          args.prNumber,
          args.threadId
        );
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}