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
    run(repo: string, prNumber: number, maxIterations?: number, dryRun?: boolean): Promise<{
        success: boolean;
        processed: number;
        resolved: number;
        rejected: number;
        needsReview: number;
        errors: string[];
    }>;
    private runIteration;
    private analyzeThread;
    executeTool(name: string, args: any): Promise<any>;
}
//# sourceMappingURL=orchestrator.d.ts.map