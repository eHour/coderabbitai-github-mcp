import winston from 'winston';

const logLevel = process.env.LOG_LEVEL || 'info';
let isDryRun = process.env.DRY_RUN === 'true';

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
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    customFormat
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        customFormat
      ),
    }),
  ],
});

if (process.env.LOG_FILE) {
  logger.add(
    new winston.transports.File({
      filename: process.env.LOG_FILE,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    })
  );
}

export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  debug(message: string, metadata: Record<string, unknown> = {}): void {
    logger.debug(message, { context: this.context, ...metadata });
  }

  info(message: string, metadata: Record<string, unknown> = {}): void {
    logger.info(message, { context: this.context, ...metadata });
  }

  warn(message: string, metadata: Record<string, unknown> = {}): void {
    logger.warn(message, { context: this.context, ...metadata });
  }

  error(message: string, err?: unknown, metadata: Record<string, unknown> = {}): void {
    if (err instanceof Error) {
      logger.error(message, {
        context: this.context,
        error: {
          message: err.message,
          stack: err.stack,
        },
        ...metadata,
      });
    } else {
      logger.error(message, { context: this.context, error: err, ...metadata });
    }
  }

  thread(threadId: string, message: string, metadata: Record<string, unknown> = {}): void {
    logger.info(message, {
      context: this.context,
      threadId,
      ...metadata,
    });
  }

  dryRun(action: string, details: unknown): void {
    if (isDryRun) {
      logger.info(`Would ${action}`, {
        context: this.context,
        dryRun: true,
        details,
      });
    }
  }

  static setLogLevel(level: string): void {
    logger.level = level;
  }

  static setDryRun(enabled: boolean): void {
    isDryRun = enabled;
  }

  static enableFileLogging(filename: string): void {
    logger.add(
      new winston.transports.File({
        filename,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
      })
    );
  }
}