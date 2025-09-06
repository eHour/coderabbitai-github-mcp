import { ThreadState } from '../types/index.js';
export declare class StateManager {
    private state;
    private mutex;
    private logger;
    private listeners;
    getThreadState(threadId: string): Promise<ThreadState | undefined>;
    updateThreadState(threadId: string, updater: (state?: ThreadState) => ThreadState): Promise<ThreadState>;
    batchUpdateThreadStates(updates: Array<{
        threadId: string;
        state: Partial<ThreadState>;
    }>): Promise<void>;
    getAllThreadStates(): Promise<ThreadState[]>;
    getThreadsByStatus(status: ThreadState['status']): Promise<ThreadState[]>;
    getThreadsByCommit(commitSha: string): Promise<ThreadState[]>;
    markThreadsAsProcessing(threadIds: string[]): Promise<void>;
    markThreadsAsPushed(threadIds: string[], commitSha: string): Promise<void>;
    markThreadsAsFailed(threadIds: string[], error: string, ciRunUrl?: string): Promise<void>;
    resetState(): Promise<void>;
    subscribe(threadId: string, callback: (state: ThreadState) => void): () => void;
    private notifyListeners;
    getStatistics(): Promise<{
        total: number;
        byStatus: Record<ThreadState['status'], number>;
        averageAttempts: number;
    }>;
}
//# sourceMappingURL=state-manager.d.ts.map