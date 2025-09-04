export declare class WorkerPool<T> {
    private available;
    private busy;
    private waiting;
    private logger;
    constructor(workers: T[]);
    acquire(): Promise<T>;
    release(worker: T): void;
    execute<R>(task: (worker: T) => Promise<R>): Promise<R>;
    getStats(): {
        total: number;
        available: number;
        busy: number;
        waiting: number;
    };
    drain(): Promise<void>;
    reset(): void;
}
//# sourceMappingURL=worker-pool.d.ts.map