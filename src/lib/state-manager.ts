import { Mutex } from 'async-mutex';
import { ThreadState } from '../types/index.js';
import { Logger } from './logger.js';

export class StateManager {
  private state = new Map<string, ThreadState>();
  private mutex = new Mutex();
  private logger = new Logger('StateManager');
  private listeners = new Map<string, Set<(state: ThreadState) => void>>();

  async getThreadState(threadId: string): Promise<ThreadState | undefined> {
    const release = await this.mutex.acquire();
    try {
      return this.state.get(threadId);
    } finally {
      release();
    }
  }

  async updateThreadState(
    threadId: string,
    updater: (state?: ThreadState) => ThreadState
  ): Promise<ThreadState> {
    const release = await this.mutex.acquire();
    let newState: ThreadState;
    let callbacks: Array<(s: ThreadState) => void> = [];
    try {
      const currentState = this.state.get(threadId);
      newState = updater(currentState);
      
      this.state.set(threadId, newState);
      this.logger.debug(`Thread state updated: ${threadId}`, {
        from: currentState?.status,
        to: newState.status,
      });

      // Capture listeners to notify after releasing the lock
      const ls = this.listeners.get(threadId);
      callbacks = ls ? Array.from(ls) : [];
    } finally {
      release();
    }
    
    // Notify listeners outside the lock
    for (const cb of callbacks) {
      try {
        cb(newState);
      } catch (error) {
        this.logger.error(`Listener error for thread ${threadId}`, error);
      }
    }
    
    return newState;
  }

  async batchUpdateThreadStates(
    updates: Array<{ threadId: string; state: Partial<ThreadState> }>
  ): Promise<void> {
    const release = await this.mutex.acquire();
    const notifications: Array<{ threadId: string; state: ThreadState }> = [];
    try {
      for (const { threadId, state } of updates) {
        const currentState = this.state.get(threadId) || {
          threadId,
          status: 'pending' as const,
          attempts: 0,
        };
        
        const newState = { ...currentState, ...state };
        this.state.set(threadId, newState);
        notifications.push({ threadId, state: newState });
      }
      
      this.logger.debug(`Batch updated ${updates.length} thread states`);
    } finally {
      release();
    }
    
    // Notify listeners outside the lock
    for (const { threadId, state } of notifications) {
      this.notifyListeners(threadId, state);
    }
  }

  async getAllThreadStates(): Promise<ThreadState[]> {
    const release = await this.mutex.acquire();
    try {
      return Array.from(this.state.values());
    } finally {
      release();
    }
  }

  async getThreadsByStatus(status: ThreadState['status']): Promise<ThreadState[]> {
    const release = await this.mutex.acquire();
    try {
      return Array.from(this.state.values()).filter(s => s.status === status);
    } finally {
      release();
    }
  }

  async getThreadsByCommit(commitSha: string): Promise<ThreadState[]> {
    const release = await this.mutex.acquire();
    try {
      return Array.from(this.state.values()).filter(s => s.commitSha === commitSha);
    } finally {
      release();
    }
  }

  async markThreadsAsProcessing(threadIds: string[]): Promise<void> {
    const release = await this.mutex.acquire();
    const notifications: Array<{ threadId: string; state: ThreadState }> = [];
    try {
      for (const threadId of threadIds) {
        const state = this.state.get(threadId) || {
          threadId,
          status: 'pending' as const,
          attempts: 0,
        };
        
        state.status = 'processing';
        state.attempts++;
        this.state.set(threadId, state);
        notifications.push({ threadId, state });
      }
    } finally {
      release();
    }
    
    // Notify listeners outside the lock
    for (const { threadId, state } of notifications) {
      this.notifyListeners(threadId, state);
    }
  }

  async markThreadsAsPushed(threadIds: string[], commitSha: string): Promise<void> {
    const release = await this.mutex.acquire();
    const notifications: Array<{ threadId: string; state: ThreadState }> = [];
    try {
      for (const threadId of threadIds) {
        const state = this.state.get(threadId);
        if (state) {
          state.status = 'pushed';
          state.commitSha = commitSha;
          notifications.push({ threadId, state });
        }
      }
    } finally {
      release();
    }
    
    // Notify listeners outside the lock
    for (const { threadId, state } of notifications) {
      this.notifyListeners(threadId, state);
    }
  }

  async markThreadsAsFailed(threadIds: string[], error: string, ciRunUrl?: string): Promise<void> {
    const release = await this.mutex.acquire();
    const notifications: Array<{ threadId: string; state: ThreadState }> = [];
    try {
      for (const threadId of threadIds) {
        const state = this.state.get(threadId);
        if (state) {
          state.status = 'ci_failed';
          state.lastError = error;
          state.ciRunUrl = ciRunUrl;
          notifications.push({ threadId, state });
        }
      }
    } finally {
      release();
    }
    
    // Notify listeners outside the lock
    for (const { threadId, state } of notifications) {
      this.notifyListeners(threadId, state);
    }
  }

  async resetState(): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      this.state.clear();
      this.listeners.clear();
      this.logger.info('State reset');
    } finally {
      release();
    }
  }

  subscribe(threadId: string, callback: (state: ThreadState) => void): () => void {
    if (!this.listeners.has(threadId)) {
      this.listeners.set(threadId, new Set());
    }
    
    this.listeners.get(threadId)!.add(callback);
    
    // Return unsubscribe function
    return () => {
      const listeners = this.listeners.get(threadId);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this.listeners.delete(threadId);
        }
      }
    };
  }

  private notifyListeners(threadId: string, state: ThreadState): void {
    const listeners = this.listeners.get(threadId);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(state);
        } catch (error) {
          this.logger.error(`Listener error for thread ${threadId}`, error);
        }
      });
    }
  }

  async getStatistics(): Promise<{
    total: number;
    byStatus: Record<ThreadState['status'], number>;
    averageAttempts: number;
  }> {
    const release = await this.mutex.acquire();
    try {
      const states = Array.from(this.state.values());
      const byStatus: Record<ThreadState['status'], number> = {
        pending: 0,
        processing: 0,
        pushed: 0,
        resolved: 0,
        rejected: 0,
        needs_review: 0,
        ci_failed: 0,
      };

      let totalAttempts = 0;
      
      for (const state of states) {
        byStatus[state.status]++;
        totalAttempts += state.attempts;
      }

      return {
        total: states.length,
        byStatus,
        averageAttempts: states.length > 0 ? totalAttempts / states.length : 0,
      };
    } finally {
      release();
    }
  }
}