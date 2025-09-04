import { MessageBus } from '../lib/message-bus.js';
import { StateManager } from '../lib/state-manager.js';
import { Config, PatchRequest } from '../types/index.js';
export declare class CodePatcherAgent {
    private messageBus;
    private config;
    private logger;
    private git;
    private workDir;
    constructor(messageBus: MessageBus, _stateManager: StateManager, config: Config);
    private setupMessageHandlers;
    applyBatch(_repo: string, _prNumber: number, patches: PatchRequest[]): Promise<{
        success: boolean;
        applied: string[];
        failed: string[];
    }>;
    private applyPatch;
    private extractFilePathFromPatch;
    private applyUnifiedDiff;
    private applyHunk;
    commitAndPush(_repo: string, _prNumber: number, message: string): Promise<string>;
    revertCommit(_repo: string, commitSha: string): Promise<void>;
    checkoutBranch(branchName: string, baseBranch?: string): Promise<void>;
    ensureCleanWorkingDirectory(): Promise<boolean>;
}
//# sourceMappingURL=code-patcher.d.ts.map