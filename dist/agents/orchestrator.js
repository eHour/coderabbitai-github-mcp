import { Logger } from '../lib/logger.js';
import { WorkerPool } from '../lib/worker-pool.js';
import { ValidationResult } from '../types/index.js';
import { GitHubAPIAgent } from './github-api.js';
import { ThreadAnalyzerAgent } from './thread-analyzer.js';
import { CodePatcherAgent } from './code-patcher.js';
import { MonitorAgent } from './monitor.js';
import PQueue from 'p-queue';
export class OrchestratorAgent {
    messageBus;
    stateManager;
    logger = new Logger('Orchestrator');
    githubAgent;
    patcherAgent;
    monitorAgent;
    analyzerPool;
    taskQueue;
    constructor(messageBus, stateManager, config) {
        this.messageBus = messageBus;
        this.stateManager = stateManager;
        this.githubAgent = new GitHubAPIAgent(messageBus, config);
        this.patcherAgent = new CodePatcherAgent(messageBus, stateManager, config);
        this.monitorAgent = new MonitorAgent(messageBus, stateManager, config);
        // Create analyzer pool
        const analyzers = [];
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
    setupMessageHandlers() {
        this.messageBus.subscribe('orchestrator', async (message) => {
            this.logger.debug(`Received message: ${message.type}`);
        });
    }
    getRateLimitStatus() {
        return this.githubAgent.getRateLimitStatus();
    }
    async getUnresolvedThreads(repo, prNumber, page = 1, pageSize = 10) {
        try {
            console.error('DEBUG Orchestrator: Start getUnresolvedThreads');
            // Validate and constrain pageSize
            pageSize = Math.min(Math.max(1, pageSize || 10), 50);
            page = Math.max(1, page || 1);
            console.error('DEBUG Orchestrator: Calling listReviewThreads');
            const allThreads = await this.githubAgent.listReviewThreads(repo, prNumber, true);
            console.error('DEBUG Orchestrator: Got threads, filtering for coderabbitai');
            const coderabbitThreads = allThreads.threads.filter(t => t.author.login === 'coderabbitai');
            // Apply pagination to CodeRabbit threads
            const startIndex = (page - 1) * pageSize;
            const endIndex = startIndex + pageSize;
            const paginatedThreads = coderabbitThreads.slice(startIndex, endIndex);
            console.error('DEBUG Orchestrator: Mapping threads');
            const threads = paginatedThreads.map(thread => ({
                id: thread.id,
                path: thread.path,
                line: thread.line,
                body: thread.body,
                createdAt: thread.createdAt
                // Note: suggestion extraction removed to reduce initial response size
                // Suggestion will be extracted when thread is actually processed
            }));
            console.error('DEBUG Orchestrator: Returning result');
            return {
                threads,
                totalCount: coderabbitThreads.length,
                hasMore: endIndex < coderabbitThreads.length,
                page,
                pageSize
            };
        }
        catch (error) {
            console.error('ERROR in Orchestrator.getUnresolvedThreads:');
            console.error('Message:', error.message);
            console.error('Stack:', error.stack?.substring(0, 500));
            throw error;
        }
    }
    async applyValidatedFix(repo, prNumber, threadId, filePath, diffString, commitMessage) {
        try {
            // Apply the patch using the batch method with a single patch
            const patchRequest = {
                threadId,
                filePath,
                patch: diffString
            };
            const result = await this.patcherAgent.applyBatch(repo, prNumber, [patchRequest]);
            if (!result.success || result.failed.length > 0) {
                throw new Error(`Failed to apply patch: ${result.failed.join(', ')}`);
            }
            // Commit and push
            const message = commitMessage || `Fix: Apply validated fix for thread ${threadId}`;
            await this.patcherAgent.commitAndPush(repo, prNumber, message);
            // Resolve the thread
            await this.githubAgent.resolveThread(repo, prNumber, threadId);
            return { success: true, message: 'Fix applied successfully' };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return { success: false, message: errorMessage };
        }
    }
    async run(repo, prNumber, maxIterations = 3, dryRun = false, validationMode = 'internal') {
        this.logger.info(`Starting orchestration for ${repo}#${prNumber}`);
        const result = {
            success: true,
            processed: 0,
            resolved: 0,
            rejected: 0,
            needsReview: 0,
            errors: [],
        };
        try {
            // Pre-flight checks
            const prMeta = await this.githubAgent.getPRMeta(repo, prNumber);
            if (prMeta.isDraft || prMeta.state === 'closed') {
                throw new Error(`PR ${prNumber} is ${prMeta.isDraft ? 'draft' : 'closed'}`);
            }
            // If external validation mode, just return the threads for Claude to analyze
            if (validationMode === 'external') {
                const threadsData = await this.getUnresolvedThreads(repo, prNumber, 1, 100);
                return {
                    ...result,
                    threads: threadsData.threads,
                    needsReview: threadsData.totalCount,
                    totalCount: threadsData.totalCount,
                    hasMore: threadsData.hasMore
                };
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
                const unresolvedResult = await this.githubAgent.listReviewThreads(repo, prNumber, true);
                const codeRabbitThreads = unresolvedResult.threads.filter(t => t.author.login === 'coderabbitai');
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
        }
        catch (error) {
            this.logger.error('Orchestration failed', error);
            result.success = false;
            result.errors.push(error instanceof Error ? error.message : String(error));
        }
        finally {
            // Stop any active polling for this PR
            this.monitorAgent.stopPolling(repo, prNumber);
        }
        return result;
    }
    async runIteration(repo, prNumber, dryRun) {
        const result = {
            processed: 0,
            resolved: 0,
            rejected: 0,
            needsReview: 0,
            errors: [],
        };
        try {
            // 1. Fetch all unresolved threads
            const threadsResult = await this.githubAgent.listReviewThreads(repo, prNumber, true);
            const codeRabbitThreads = threadsResult.threads.filter(t => t.author.login === 'coderabbitai');
            this.logger.info(`\n${'='.repeat(70)}`);
            this.logger.info(`📊 Found ${codeRabbitThreads.length} unresolved CodeRabbit threads`);
            this.logger.info(`${'='.repeat(70)}`);
            if (codeRabbitThreads.length === 0) {
                return result;
            }
            // Log thread details for visibility
            codeRabbitThreads.forEach((thread, index) => {
                const preview = thread.body.replace(/\n/g, ' ').substring(0, 60);
                const location = thread.path ? `${thread.path}:${thread.line || '?'}` : 'no file';
                this.logger.info(`Thread ${index + 1}/${codeRabbitThreads.length}: ${location} - "${preview}..."`);
            });
            // Step 1: REVIEW - Analyze all threads
            this.logger.info(`\n📋 STEP 1: REVIEW - Analyzing ${codeRabbitThreads.length} threads...`);
            await this.stateManager.markThreadsAsProcessing(codeRabbitThreads.map(t => t.id));
            // Analyze threads in parallel
            const analysisPromises = codeRabbitThreads.map(thread => this.taskQueue.add(() => this.analyzeThread(thread, repo, prNumber)));
            const analyses = await Promise.allSettled(analysisPromises);
            // 4. Collect valid fixes
            const validFixes = [];
            const invalidThreads = [];
            const needsReviewThreads = [];
            for (const analysis of analyses) {
                result.processed++;
                if (analysis.status === 'rejected') {
                    result.errors.push(String(analysis.reason));
                    continue;
                }
                const analysisResult = analysis.value;
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
            // Step 2: FIX - Apply valid fixes
            if (validFixes.length > 0 && !dryRun) {
                this.logger.info(`\n🔧 STEP 2: FIX - Applying ${validFixes.length} valid fixes...`);
                const patchResults = await this.patcherAgent.applyBatch(repo, prNumber, validFixes.map(f => ({
                    threadId: f.threadId,
                    filePath: '', // Will be extracted from patch
                    patch: f.patch,
                })));
                if (patchResults.success) {
                    // Step 3: COMMIT
                    this.logger.info(`\n💾 STEP 3: COMMIT - Creating commit for ${validFixes.length} fixes...`);
                    const commitSha = await this.patcherAgent.commitAndPush(repo, prNumber, `fix: apply ${validFixes.length} CodeRabbit suggestions`);
                    // Step 4: PUSH
                    this.logger.info(`\n⬆️  STEP 4: PUSH - Pushing changes to remote...`);
                    this.logger.info(`   Commit SHA: ${commitSha}`);
                    await this.stateManager.markThreadsAsPushed(validFixes.map(f => f.threadId), commitSha);
                    // Wait for CI
                    this.logger.info(`\n🔄 Waiting for CI checks to complete...`);
                    const ciResult = await this.monitorAgent.waitForCI(repo, prNumber, commitSha);
                    if (ciResult === 'success') {
                        // Step 5: RESOLVE
                        this.logger.info(`\n✅ STEP 5: RESOLVE - Marking ${validFixes.length} threads as resolved...`);
                        for (const fix of validFixes) {
                            await this.githubAgent.resolveThread(repo, prNumber, fix.threadId);
                            await this.githubAgent.postComment(repo, prNumber, fix.threadId, `@coderabbitai Thanks. Applied the fix in commit ${commitSha}. Please recheck this thread.`);
                            result.resolved++;
                        }
                        this.logger.info(`   Successfully resolved all ${validFixes.length} threads!`);
                        // Step 6: NEXT
                        this.logger.info(`\n➡️  STEP 6: NEXT - Moving to next iteration...`);
                    }
                    else {
                        // CI failed - revert and notify
                        this.logger.warn('CI failed, reverting commit');
                        await this.patcherAgent.revertCommit(repo, commitSha);
                        await this.stateManager.markThreadsAsFailed(validFixes.map(f => f.threadId), 'CI check failed', `https://github.com/${repo}/pull/${prNumber}/checks?sha=${commitSha}`);
                        for (const fix of validFixes) {
                            await this.githubAgent.postComment(repo, prNumber, fix.threadId, `@coderabbitai I attempted to apply the suggested fix, but it failed CI. I have reverted the change. [View CI run](https://github.com/${repo}/pull/${prNumber}/checks?sha=${commitSha})`);
                        }
                    }
                }
                else {
                    const errMsg = patchResults.failed.length > 0
                        ? `Failed to apply patches for threads: ${patchResults.failed.join(', ')}`
                        : 'Failed to apply patches';
                    this.logger.warn(errMsg);
                    result.errors.push(errMsg);
                    // Mark as needs review since patch couldn't be applied
                    for (const fix of validFixes) {
                        await this.githubAgent.postComment(repo, prNumber, fix.threadId, `@coderabbitai I could not apply the suggested patch: ${errMsg}. Please provide an updated diff.`);
                    }
                }
            }
            else if (dryRun && validFixes.length > 0) {
                this.logger.dryRun('apply fixes', { count: validFixes.length });
                result.resolved = validFixes.length;
            }
            // 10. Handle invalid and needs-review threads
            for (const invalid of invalidThreads) {
                if (!dryRun) {
                    await this.githubAgent.postComment(repo, prNumber, invalid.threadId, `@coderabbitai Thank you for the suggestion. We believe this is not valid because: ${invalid.reasoning}. Could you point to a failing case if you see one?`);
                }
                else {
                    this.logger.dryRun('post invalid comment', { threadId: invalid.threadId });
                }
            }
            for (const needsReview of needsReviewThreads) {
                if (!dryRun) {
                    const message = needsReview.result === ValidationResult.UNPATCHABLE
                        ? `@coderabbitai I could not apply this suggestion as the patch failed. The surrounding code may have changed. Please provide an updated suggestion.`
                        : `@coderabbitai This suggestion requires human review. My analysis confidence is below threshold (${Math.round(needsReview.confidence * 100)}%). Could you clarify the expected behavior?`;
                    await this.githubAgent.postComment(repo, prNumber, needsReview.threadId, message);
                }
                else {
                    this.logger.dryRun('post needs-review comment', { threadId: needsReview.threadId });
                }
            }
        }
        catch (error) {
            this.logger.error('Iteration failed', error);
            result.errors.push(error instanceof Error ? error.message : String(error));
        }
        return result;
    }
    async analyzeThread(thread, repo, prNumber) {
        const worker = await this.analyzerPool.acquire();
        try {
            return await worker.analyzeThread(thread, repo, prNumber);
        }
        finally {
            this.analyzerPool.release(worker);
        }
    }
    async executeTool(name, args) {
        // Delegate tool execution to appropriate agents
        switch (name) {
            case 'github_get_pr_meta':
                return await this.githubAgent.getPRMeta(args.repo, args.prNumber);
            case 'github_list_review_threads':
                return await this.githubAgent.listReviewThreads(args.repo, args.prNumber, args.onlyUnresolved, args.page, args.pageSize);
            case 'github_post_review_comment':
                return await this.githubAgent.postComment(args.repo, args.prNumber, args.threadId, args.body);
            case 'github_resolve_thread':
                return await this.githubAgent.resolveThread(args.repo, args.prNumber, args.threadId);
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
}
//# sourceMappingURL=orchestrator.js.map