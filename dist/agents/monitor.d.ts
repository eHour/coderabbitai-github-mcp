import { MessageBus } from '../lib/message-bus.js';
import { StateManager } from '../lib/state-manager.js';
import { Config, CheckRunConclusion } from '../types/index.js';
export declare class MonitorAgent {
    private messageBus;
    private stateManager;
    private config;
    private logger;
    private githubAgent;
    private pollingIntervals;
    private lastSeenCommentId;
    private activePollsInProgress;
    constructor(messageBus: MessageBus, stateManager: StateManager, config: Config);
    private setupMessageHandlers;
    waitForCI(repo: string, prNumber: number, commitSha: string): Promise<CheckRunConclusion>;
    pollForUpdates(repo: string, prNumber: number, intervalMs?: number): Promise<void>;
    stopPolling(repo: string, prNumber: number): void;
    stopAllPolling(): void;
    checkPRStatus(repo: string, prNumber: number): Promise<{
        isOpen: boolean;
        isDraft: boolean;
        hasUnresolvedThreads: boolean;
        codeRabbitThreadCount: number;
    }>;
    generateProgressReport(repo: string, prNumber: number): Promise<string>;
}
//# sourceMappingURL=monitor.d.ts.map