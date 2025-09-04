import { MessageBus } from '../lib/message-bus.js';
import { Config, ReviewThread, PullRequest, CheckRunConclusion } from '../types/index.js';
export declare class GitHubAPIAgent {
    private messageBus;
    private config;
    private logger;
    private graphqlClient;
    private restClient;
    private rateLimiter;
    constructor(messageBus: MessageBus, config: Config);
    private setupMessageHandlers;
    getRateLimitStatus(): any;
    private parseRepo;
    getPRMeta(repo: string, prNumber: number): Promise<PullRequest>;
    listReviewThreads(repo: string, prNumber: number, onlyUnresolved?: boolean, page?: number, pageSize?: number): Promise<{
        threads: ReviewThread[];
        totalCount: number;
        hasMore: boolean;
    }>;
    postComment(repo: string, prNumber: number, threadId: string, body: string): Promise<{
        success: boolean;
        commentId?: string;
    }>;
    resolveThread(repo: string, prNumber: number, threadId: string): Promise<{
        success: boolean;
    }>;
    waitForCheckRuns(repo: string, commitSha: string, maxAttempts?: number, waitInterval?: number): Promise<CheckRunConclusion>;
    getCheckRunsUrl(repo: string, prNumber: number, commitSha: string): Promise<string>;
}
//# sourceMappingURL=github-api.d.ts.map