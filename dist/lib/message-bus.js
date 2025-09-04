import { EventEmitter } from 'eventemitter3';
import { Logger } from './logger.js';
import { v4 as uuidv4 } from 'uuid';
const MAX_MESSAGE_LOG_SIZE = 10000; // Prevent memory leak with circular buffer
export class MessageBus extends EventEmitter {
    logger = new Logger('MessageBus');
    messageLog = [];
    pendingResponses = new Map();
    constructor() {
        super();
        this.setupErrorHandling();
    }
    setupErrorHandling() {
        this.on('error', (error) => {
            this.logger.error('Message bus error', error);
        });
    }
    send(message) {
        const fullMessage = {
            ...message,
            id: uuidv4(),
            timestamp: new Date(),
        };
        this.messageLog.push(fullMessage);
        // Prevent memory leak by maintaining circular buffer
        if (this.messageLog.length > MAX_MESSAGE_LOG_SIZE) {
            this.messageLog.shift(); // Remove oldest message
        }
        this.logger.debug(`Message sent: ${message.source} -> ${message.target}`, {
            type: message.type,
            correlationId: message.correlationId,
        });
        this.emit(message.target, fullMessage);
    }
    async request(message, timeoutMs = 30000) {
        const messageId = uuidv4();
        const fullMessage = {
            ...message,
            id: messageId,
            timestamp: new Date(),
        };
        return new Promise((resolve, reject) => {
            const responseChannel = `${message.source}-response`;
            let timeout;
            const responseHandler = (response) => {
                if (response.correlationId !== messageId)
                    return;
                clearTimeout(timeout);
                this.pendingResponses.delete(messageId);
                this.off(responseChannel, responseHandler);
                resolve(response.payload);
            };
            timeout = setTimeout(() => {
                this.off(responseChannel, responseHandler);
                this.pendingResponses.delete(messageId);
                reject(new Error(`Request timeout: ${message.type} to ${message.target}`));
            }, timeoutMs);
            this.pendingResponses.set(messageId, { resolve, reject, timeout });
            this.on(responseChannel, responseHandler);
            this.messageLog.push(fullMessage);
            // Prevent memory leak by maintaining circular buffer
            if (this.messageLog.length > MAX_MESSAGE_LOG_SIZE) {
                this.messageLog.shift(); // Remove oldest message
            }
            this.emit(message.target, fullMessage);
        });
    }
    subscribe(agentId, handler) {
        this.on(agentId, async (message) => {
            try {
                await handler(message);
            }
            catch (error) {
                this.logger.error(`Handler error in ${agentId}`, error);
                this.emit('error', error);
            }
        });
    }
    respond(originalMessage, response) {
        const responseMessage = {
            id: uuidv4(),
            type: 'RESPONSE',
            source: originalMessage.target,
            target: `${originalMessage.source}-response`,
            payload: response,
            correlationId: originalMessage.id,
            timestamp: new Date(),
        };
        this.emit(responseMessage.target, responseMessage);
    }
    getMessageLog(filter) {
        let messages = [...this.messageLog];
        if (filter) {
            if (filter.source) {
                messages = messages.filter(m => m.source === filter.source);
            }
            if (filter.target) {
                messages = messages.filter(m => m.target === filter.target);
            }
            if (filter.type) {
                messages = messages.filter(m => m.type === filter.type);
            }
            if (filter.since) {
                messages = messages.filter(m => m.timestamp >= filter.since);
            }
        }
        return messages;
    }
    clearMessageLog() {
        this.messageLog = [];
    }
}
//# sourceMappingURL=message-bus.js.map