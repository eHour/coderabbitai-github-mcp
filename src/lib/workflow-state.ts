import { ReviewThread } from '../types/index.js';

export interface WorkflowState {
  repo: string;
  prNumber: number;
  threads: ReviewThread[];
  currentIndex: number;
  processed: number;
  decisions: Map<string, {
    isValid: boolean;
    reason?: string;
    fixApplied?: boolean;
    commitSha?: string;
  }>;
  startedAt: Date;
  lastUpdated: Date;
}

export class WorkflowStateManager {
  private states: Map<string, WorkflowState> = new Map();

  private getKey(repo: string, prNumber: number): string {
    return `${repo}#${prNumber}`;
  }

  create(repo: string, prNumber: number, threads: ReviewThread[]): WorkflowState {
    const key = this.getKey(repo, prNumber);
    const state: WorkflowState = {
      repo,
      prNumber,
      threads,
      currentIndex: 0,
      processed: 0,
      decisions: new Map(),
      startedAt: new Date(),
      lastUpdated: new Date()
    };
    
    this.states.set(key, state);
    return state;
  }

  get(repo: string, prNumber: number): WorkflowState | undefined {
    return this.states.get(this.getKey(repo, prNumber));
  }

  getOrCreate(repo: string, prNumber: number, threads: ReviewThread[]): WorkflowState {
    let state = this.get(repo, prNumber);
    if (!state) {
      state = this.create(repo, prNumber, threads);
    }
    return state;
  }

  getCurrentThread(repo: string, prNumber: number): ReviewThread | undefined {
    const state = this.get(repo, prNumber);
    if (!state) return undefined;
    return state.threads[state.currentIndex];
  }

  recordDecision(
    repo: string, 
    prNumber: number, 
    threadId: string, 
    isValid: boolean, 
    reason?: string
  ): void {
    const state = this.get(repo, prNumber);
    if (!state) return;
    
    state.decisions.set(threadId, { isValid, reason });
    state.lastUpdated = new Date();
  }

  recordApplication(
    repo: string,
    prNumber: number,
    threadId: string,
    commitSha: string
  ): void {
    const state = this.get(repo, prNumber);
    if (!state) return;
    
    const decision = state.decisions.get(threadId);
    if (decision) {
      decision.fixApplied = true;
      decision.commitSha = commitSha;
    }
    state.lastUpdated = new Date();
  }

  advance(repo: string, prNumber: number): boolean {
    const state = this.get(repo, prNumber);
    if (!state) return false;
    
    state.currentIndex = Math.min(state.currentIndex + 1, state.threads.length);
    state.processed++;
    state.lastUpdated = new Date();
    
    return state.currentIndex < state.threads.length;
  }

  getProgress(repo: string, prNumber: number): {
    total: number;
    processed: number;
    remaining: number;
    percentComplete: number;
  } {
    const state = this.get(repo, prNumber);
    if (!state) {
      return { total: 0, processed: 0, remaining: 0, percentComplete: 0 };
    }
    
    return {
      total: state.threads.length,
      processed: state.processed,
      remaining: state.threads.length - state.processed,
      percentComplete: state.threads.length > 0 
        ? Math.round((state.processed / state.threads.length) * 100)
        : 0
    };
  }

  clear(repo: string, prNumber: number): void {
    this.states.delete(this.getKey(repo, prNumber));
  }

  clearAll(): void {
    this.states.clear();
  }
}

// Singleton instance
export const workflowStateManager = new WorkflowStateManager();