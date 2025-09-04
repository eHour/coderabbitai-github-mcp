export declare class Logger {
    private context;
    constructor(context: string);
    debug(message: string, metadata?: Record<string, unknown>): void;
    info(message: string, metadata?: Record<string, unknown>): void;
    warn(message: string, metadata?: Record<string, unknown>): void;
    error(message: string, err?: unknown, metadata?: Record<string, unknown>): void;
    thread(threadId: string, message: string, metadata?: Record<string, unknown>): void;
    dryRun(action: string, details: unknown): void;
    static setLogLevel(level: string): void;
    static enableFileLogging(filename: string): void;
}
//# sourceMappingURL=logger.d.ts.map