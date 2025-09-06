import { MessageBus } from '../lib/message-bus.js';
import { StateManager } from '../lib/state-manager.js';
import { Config } from '../types/index.js';
export declare class OrchestratorAgent {
    private messageBus;
    private stateManager;
    private logger;
    private githubAgent;
    private patcherAgent;
    private monitorAgent;
    private analyzerPool;
    private taskQueue;
    constructor(messageBus: MessageBus, stateManager: StateManager, config: Config);
    private setupMessageHandlers;
    getRateLimitStatus(): any;
    getUnresolvedThreads(repo: string, prNumber: number, page?: number, pageSize?: number): Promise<{
        threads: any[];
        totalCount: number;
        hasMore: boolean;
        page: number;
        pageSize: number;
    }>;
    applyValidatedFix(repo: string, prNumber: number, threadId: string, filePath: string, diffString: string, commitMessage?: string): Promise<{
        success: boolean;
        message: string;
    }>;
    run(repo: string, prNumber: number, maxIterations?: number, dryRun?: boolean, validationMode?: 'internal' | 'external'): Promise<{
        success: boolean;
        processed: number;
        resolved: number;
        rejected: number;
        needsReview: number;
        errors: string[];
        threads?: any[];
        totalCount?: number;
        hasMore?: boolean;
    }>;
    private runIteration;
    private analyzeThread;
    executeTool(name: string, args: any): Promise<any>;
}
//# sourceMappingURL=orchestrator.d.ts.map