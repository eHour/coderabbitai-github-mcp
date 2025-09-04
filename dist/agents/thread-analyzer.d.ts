import { MessageBus } from '../lib/message-bus.js';
import { StateManager } from '../lib/state-manager.js';
import { Config, ReviewThread, AnalysisResult } from '../types/index.js';
export declare class ThreadAnalyzerAgent {
    private workerId;
    private messageBus;
    private config;
    private logger;
    private openai?;
    constructor(workerId: number, messageBus: MessageBus, _stateManager: StateManager, config: Config);
    private setupMessageHandlers;
    analyzeThread(thread: ReviewThread, _repo: string, _prNumber: number): Promise<AnalysisResult>;
    private extractSuggestion;
    private applyHeuristics;
    private matchesPattern;
    private validateWithLLM;
    private generatePatchFromSuggestion;
}
//# sourceMappingURL=thread-analyzer.d.ts.map