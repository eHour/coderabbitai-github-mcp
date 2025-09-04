import { MessageBus } from '../lib/message-bus.js';
import { Config, ReviewThread, PullRequest, CheckRunConclusion } from '../types/index.js';
export declare class GitHubAPIAgent {
    private messageBus;
    private config;
    private logger;
    private graphqlClient;
    private restClient;
    constructor(messageBus: MessageBus, config: Config);
    private setupMessageHandlers;
    getPRMeta(repo: string, prNumber: number): Promise<PullRequest>;
    listReviewThreads(repo: string, prNumber: number, onlyUnresolved?: boolean): Promise<ReviewThread[]>;
    postComment(repo: string, prNumber: number, threadId: string, body: string): Promise<void>;
    resolveThread(repo: string, prNumber: number, threadId: string): Promise<void>;
    waitForCheckRuns(repo: string, commitSha: string, maxAttempts?: number, waitInterval?: number): Promise<CheckRunConclusion>;
    getCheckRunsUrl(repo: string, prNumber: number, commitSha: string): Promise<string>;
}
//# sourceMappingURL=github-api.d.ts.map