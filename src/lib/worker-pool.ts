import { Logger } from './logger.js';

export class WorkerPool<T> {
  private available: T[] = [];
  private busy = new Set<T>();
  private waiting: Array<(worker: T) => void> = [];
  private logger = new Logger('WorkerPool');

  constructor(workers: T[]) {
    this.available = [...workers];
    this.logger.info(`Initialized pool with ${workers.length} workers`);
  }

  async acquire(): Promise<T> {
    // If worker available, return immediately
    if (this.available.length > 0) {
      const worker = this.available.shift()!;
      this.busy.add(worker);
      this.logger.debug(`Worker acquired, ${this.available.length} available`);
      return worker;
    }

    // Otherwise wait for one to become available
    return new Promise((resolve) => {
      this.waiting.push(resolve);
      this.logger.debug(`Worker requested, ${this.waiting.length} in queue`);
    });
  }

  release(worker: T): void {
    if (!this.busy.has(worker)) {
      this.logger.warn('Attempted to release worker that was not busy');
      return;
    }

    this.busy.delete(worker);

    // If someone is waiting, give them the worker
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      this.busy.add(worker);
      resolve(worker);
      this.logger.debug(`Worker reassigned, ${this.waiting.length} in queue`);
    } else {
      // Otherwise return to available pool
      this.available.push(worker);
      this.logger.debug(`Worker released, ${this.available.length} available`);
    }
  }

  async execute<R>(task: (worker: T) => Promise<R>): Promise<R> {
    const worker = await this.acquire();
    try {
      return await task(worker);
    } finally {
      this.release(worker);
    }
  }

  getStats(): {
    total: number;
    available: number;
    busy: number;
    waiting: number;
  } {
    return {
      total: this.available.length + this.busy.size,
      available: this.available.length,
      busy: this.busy.size,
      waiting: this.waiting.length,
    };
  }

  async drain(): Promise<void> {
    // Wait for all busy workers to be released
    while (this.busy.size > 0 || this.waiting.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  reset(): void {
    // Move all busy workers back to available
    for (const worker of this.busy) {
      this.available.push(worker);
    }
    this.busy.clear();
    
    // Clear all waiting requests
    // Note: In production, we'd want to track reject functions too
    this.waiting = [];
    
    this.logger.info('Worker pool reset');
  }
}