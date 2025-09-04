import winston from 'winston';
const logLevel = process.env.LOG_LEVEL || 'info';
const isDryRun = process.env.DRY_RUN === 'true';
const customFormat = winston.format.printf(({ level, message, timestamp, context, ...metadata }) => {
    let msg = `${timestamp} [${level.toUpperCase()}] ${context ? `[${context}] ` : ''}${message}`;
    if (isDryRun && level !== 'error') {
        msg = `[DRY RUN] ${msg}`;
    }
    if (Object.keys(metadata).length > 0) {
        msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
});
const logger = winston.createLogger({
    level: logLevel,
    format: winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston.format.errors({ stack: true }), customFormat),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(winston.format.colorize(), customFormat),
        }),
    ],
});
if (process.env.LOG_FILE) {
    logger.add(new winston.transports.File({
        filename: process.env.LOG_FILE,
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    }));
}
export class Logger {
    context;
    constructor(context) {
        this.context = context;
    }
    debug(message, metadata = {}) {
        logger.debug(message, { context: this.context, ...metadata });
    }
    info(message, metadata = {}) {
        logger.info(message, { context: this.context, ...metadata });
    }
    warn(message, metadata = {}) {
        logger.warn(message, { context: this.context, ...metadata });
    }
    error(message, err, metadata = {}) {
        if (err instanceof Error) {
            logger.error(message, {
                context: this.context,
                error: {
                    message: err.message,
                    stack: err.stack,
                },
                ...metadata,
            });
        }
        else {
            logger.error(message, { context: this.context, error: err, ...metadata });
        }
    }
    thread(threadId, message, metadata = {}) {
        logger.info(message, {
            context: this.context,
            threadId,
            ...metadata,
        });
    }
    dryRun(action, details) {
        if (isDryRun) {
            logger.info(`Would ${action}`, {
                context: this.context,
                dryRun: true,
                details,
            });
        }
    }
    static setLogLevel(level) {
        logger.level = level;
    }
    static enableFileLogging(filename) {
        logger.add(new winston.transports.File({
            filename,
            format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
        }));
    }
}
//# sourceMappingURL=logger.js.map