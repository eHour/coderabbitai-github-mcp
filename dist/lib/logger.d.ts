export declare class Logger {
    private context;
    constructor(context: string);
    debug(message: string, metadata?: any): void;
    info(message: string, metadata?: any): void;
    warn(message: string, metadata?: any): void;
    error(message: string, error?: any, metadata?: any): void;
    thread(threadId: string, message: string, metadata?: any): void;
    dryRun(action: string, details: any): void;
    static setLogLevel(level: string): void;
    static enableFileLogging(filename: string): void;
}
//# sourceMappingURL=logger.d.ts.map