import { Logger } from './logger.js';
export class WorkerPool {
    available = [];
    busy = new Set();
    waiting = [];
    logger = new Logger('WorkerPool');
    constructor(workers) {
        this.available = [...workers];
        this.logger.info(`Initialized pool with ${workers.length} workers`);
    }
    async acquire() {
        // If worker available, return immediately
        if (this.available.length > 0) {
            const worker = this.available.shift();
            this.busy.add(worker);
            this.logger.debug(`Worker acquired, ${this.available.length} available`);
            return worker;
        }
        // Otherwise wait for one to become available
        return new Promise((resolve, reject) => {
            this.waiting.push({ resolve, reject });
            this.logger.debug(`Worker requested, ${this.waiting.length} in queue`);
        });
    }
    release(worker) {
        if (!this.busy.has(worker)) {
            this.logger.warn('Attempted to release worker that was not busy');
            return;
        }
        this.busy.delete(worker);
        // If someone is waiting, give them the worker
        if (this.waiting.length > 0) {
            const waiter = this.waiting.shift();
            this.busy.add(worker);
            waiter.resolve(worker);
            this.logger.debug(`Worker reassigned, ${this.waiting.length} in queue`);
        }
        else {
            // Otherwise return to available pool
            this.available.push(worker);
            this.logger.debug(`Worker released, ${this.available.length} available`);
        }
    }
    async execute(task) {
        const worker = await this.acquire();
        try {
            return await task(worker);
        }
        finally {
            this.release(worker);
        }
    }
    getStats() {
        return {
            total: this.available.length + this.busy.size,
            available: this.available.length,
            busy: this.busy.size,
            waiting: this.waiting.length,
        };
    }
    async drain() {
        // Wait for all busy workers to be released
        while (this.busy.size > 0 || this.waiting.length > 0) {
            // Fast-fail if there are waiters but no workers at all
            if (this.available.length + this.busy.size === 0 && this.waiting.length > 0) {
                throw new Error('WorkerPool drain() stalled: no workers in pool while waiters exist');
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    reset() {
        // Move all busy workers back to available
        for (const worker of this.busy) {
            this.available.push(worker);
        }
        this.busy.clear();
        // Reject all waiting requests
        for (const waiter of this.waiting) {
            waiter.reject(new Error('WorkerPool reset: pending acquire() cancelled'));
        }
        this.waiting = [];
        this.logger.info('Worker pool reset');
    }
}
//# sourceMappingURL=worker-pool.js.map