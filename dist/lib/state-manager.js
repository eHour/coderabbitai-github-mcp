import { Mutex } from 'async-mutex';
import { Logger } from './logger.js';
export class StateManager {
    state = new Map();
    mutex = new Mutex();
    logger = new Logger('StateManager');
    listeners = new Map();
    async getThreadState(threadId) {
        const release = await this.mutex.acquire();
        try {
            return this.state.get(threadId);
        }
        finally {
            release();
        }
    }
    async updateThreadState(threadId, updater) {
        const release = await this.mutex.acquire();
        try {
            const currentState = this.state.get(threadId);
            const newState = updater(currentState);
            this.state.set(threadId, newState);
            this.logger.debug(`Thread state updated: ${threadId}`, {
                from: currentState?.status,
                to: newState.status,
            });
            // Notify listeners
            this.notifyListeners(threadId, newState);
            return newState;
        }
        finally {
            release();
        }
    }
    async batchUpdateThreadStates(updates) {
        const release = await this.mutex.acquire();
        try {
            for (const { threadId, state } of updates) {
                const currentState = this.state.get(threadId) || {
                    threadId,
                    status: 'pending',
                    attempts: 0,
                };
                const newState = { ...currentState, ...state };
                this.state.set(threadId, newState);
                this.notifyListeners(threadId, newState);
            }
            this.logger.debug(`Batch updated ${updates.length} thread states`);
        }
        finally {
            release();
        }
    }
    async getAllThreadStates() {
        const release = await this.mutex.acquire();
        try {
            return Array.from(this.state.values());
        }
        finally {
            release();
        }
    }
    async getThreadsByStatus(status) {
        const release = await this.mutex.acquire();
        try {
            return Array.from(this.state.values()).filter(s => s.status === status);
        }
        finally {
            release();
        }
    }
    async getThreadsByCommit(commitSha) {
        const release = await this.mutex.acquire();
        try {
            return Array.from(this.state.values()).filter(s => s.commitSha === commitSha);
        }
        finally {
            release();
        }
    }
    async markThreadsAsProcessing(threadIds) {
        const release = await this.mutex.acquire();
        try {
            for (const threadId of threadIds) {
                const state = this.state.get(threadId) || {
                    threadId,
                    status: 'pending',
                    attempts: 0,
                };
                state.status = 'processing';
                state.attempts++;
                this.state.set(threadId, state);
                this.notifyListeners(threadId, state);
            }
        }
        finally {
            release();
        }
    }
    async markThreadsAsPushed(threadIds, commitSha) {
        const release = await this.mutex.acquire();
        try {
            for (const threadId of threadIds) {
                const state = this.state.get(threadId);
                if (state) {
                    state.status = 'pushed';
                    state.commitSha = commitSha;
                    this.notifyListeners(threadId, state);
                }
            }
        }
        finally {
            release();
        }
    }
    async markThreadsAsFailed(threadIds, error, ciRunUrl) {
        const release = await this.mutex.acquire();
        try {
            for (const threadId of threadIds) {
                const state = this.state.get(threadId);
                if (state) {
                    state.status = 'ci_failed';
                    state.lastError = error;
                    state.ciRunUrl = ciRunUrl;
                    this.notifyListeners(threadId, state);
                }
            }
        }
        finally {
            release();
        }
    }
    async resetState() {
        const release = await this.mutex.acquire();
        try {
            this.state.clear();
            this.logger.info('State reset');
        }
        finally {
            release();
        }
    }
    subscribe(threadId, callback) {
        if (!this.listeners.has(threadId)) {
            this.listeners.set(threadId, new Set());
        }
        this.listeners.get(threadId).add(callback);
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
    notifyListeners(threadId, state) {
        const listeners = this.listeners.get(threadId);
        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback(state);
                }
                catch (error) {
                    this.logger.error(`Listener error for thread ${threadId}`, error);
                }
            });
        }
    }
    async getStatistics() {
        const release = await this.mutex.acquire();
        try {
            const states = Array.from(this.state.values());
            const byStatus = {
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
        }
        finally {
            release();
        }
    }
}
//# sourceMappingURL=state-manager.js.map