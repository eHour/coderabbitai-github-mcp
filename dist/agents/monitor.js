import { Logger } from '../lib/logger.js';
import { GitHubAPIAgent } from './github-api.js';
export class MonitorAgent {
    messageBus;
    stateManager;
    config;
    logger = new Logger('Monitor');
    githubAgent;
    pollingIntervals = new Map();
    lastSeenCommentId = new Map();
    constructor(messageBus, stateManager, config) {
        this.messageBus = messageBus;
        this.stateManager = stateManager;
        this.config = config;
        this.githubAgent = new GitHubAPIAgent(messageBus, config);
        this.setupMessageHandlers();
    }
    setupMessageHandlers() {
        this.messageBus.subscribe('monitor', async (message) => {
            if (message.type === 'CHECK_CI') {
                const result = await this.waitForCI(message.payload.repo, message.payload.prNumber, message.payload.commitSha);
                this.messageBus.respond(message, result);
            }
        });
    }
    async waitForCI(repo, prNumber, commitSha) {
        this.logger.info(`Monitoring CI for commit ${commitSha}`);
        const result = await this.githubAgent.waitForCheckRuns(repo, commitSha, Math.max(1, Math.floor(this.config.ci.waitTimeout / this.config.ci.checkInterval)), this.config.ci.checkInterval);
        if (result === 'failure') {
            const url = await this.githubAgent.getCheckRunsUrl(repo, prNumber, commitSha);
            this.logger.warn(`CI failed for ${commitSha}: ${url}`);
        }
        return result;
    }
    async pollForUpdates(repo, prNumber, intervalMs = 30000) {
        const key = `${repo}#${prNumber}`;
        // Clear existing polling if any
        this.stopPolling(repo, prNumber);
        this.logger.info(`Starting to poll for updates on ${key}`);
        const poll = async () => {
            try {
                // Get latest comments
                const threadsResult = await this.githubAgent.listReviewThreads(repo, prNumber, false);
                // Check for new CodeRabbit responses
                const updates = [];
                for (const t of threadsResult.threads) {
                    const lastComment = t.comments[t.comments.length - 1];
                    if (lastComment.author.login === 'coderabbitai') {
                        const prevId = this.lastSeenCommentId.get(t.id);
                        if (lastComment.id !== prevId) {
                            updates.push(t);
                            this.lastSeenCommentId.set(t.id, lastComment.id);
                        }
                    }
                }
                const codeRabbitThreads = updates;
                if (codeRabbitThreads.length > 0) {
                    this.logger.info(`Found ${codeRabbitThreads.length} threads with new CodeRabbit responses`);
                    // Notify orchestrator about updates
                    this.messageBus.send({
                        type: 'CODERABBIT_UPDATE',
                        source: 'monitor',
                        target: 'orchestrator',
                        payload: {
                            repo,
                            prNumber,
                            threads: codeRabbitThreads,
                        },
                        correlationId: key,
                    });
                }
            }
            catch (error) {
                this.logger.error('Polling failed', error);
            }
        };
        // Start polling
        const interval = setInterval(poll, intervalMs);
        this.pollingIntervals.set(key, interval);
        // Do initial poll immediately
        await poll();
    }
    stopPolling(repo, prNumber) {
        const key = `${repo}#${prNumber}`;
        const interval = this.pollingIntervals.get(key);
        if (interval) {
            clearInterval(interval);
            this.pollingIntervals.delete(key);
            this.logger.info(`Stopped polling for ${key}`);
        }
    }
    stopAllPolling() {
        for (const [key, interval] of this.pollingIntervals) {
            clearInterval(interval);
            this.logger.info(`Stopped polling for ${key}`);
        }
        this.pollingIntervals.clear();
        this.lastSeenCommentId.clear();
    }
    async checkPRStatus(repo, prNumber) {
        const prMeta = await this.githubAgent.getPRMeta(repo, prNumber);
        const threadsResult = await this.githubAgent.listReviewThreads(repo, prNumber, true);
        const codeRabbitThreads = threadsResult.threads.filter(t => t.author.login === 'coderabbitai');
        return {
            isOpen: prMeta.state === 'open',
            isDraft: prMeta.isDraft,
            hasUnresolvedThreads: threadsResult.threads.length > 0,
            codeRabbitThreadCount: codeRabbitThreads.length,
        };
    }
    async generateProgressReport(repo, prNumber) {
        const stats = await this.stateManager.getStatistics();
        const prStatus = await this.checkPRStatus(repo, prNumber);
        const report = `
## CodeRabbit MCP Progress Report

**Repository:** ${repo}
**Pull Request:** #${prNumber}
**Status:** ${prStatus.isOpen ? 'Open' : 'Closed'}${prStatus.isDraft ? ' (Draft)' : ''}

### Thread Statistics
- **Total Threads:** ${stats.total}
- **Pending:** ${stats.byStatus.pending}
- **Processing:** ${stats.byStatus.processing}
- **Resolved:** ${stats.byStatus.resolved}
- **Rejected:** ${stats.byStatus.rejected}
- **Needs Review:** ${stats.byStatus.needs_review}
- **CI Failed:** ${stats.byStatus.ci_failed}

### Current Status
- **Unresolved CodeRabbit Threads:** ${prStatus.codeRabbitThreadCount}
- **Average Attempts per Thread:** ${stats.averageAttempts.toFixed(2)}

${stats.byStatus.ci_failed > 0 ? '⚠️ Some fixes failed CI checks and were reverted.' : ''}
${stats.byStatus.needs_review > 0 ? '⚠️ Some threads require human review.' : ''}
${prStatus.codeRabbitThreadCount === 0 ? '✅ All CodeRabbit threads have been addressed!' : ''}
`;
        return report;
    }
}
//# sourceMappingURL=monitor.js.map