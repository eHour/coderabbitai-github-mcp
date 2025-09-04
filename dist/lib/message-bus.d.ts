import { EventEmitter } from 'eventemitter3';
import { AgentMessage } from '../types/index.js';
export declare class MessageBus extends EventEmitter {
    private logger;
    private messageLog;
    private pendingResponses;
    constructor();
    private setupErrorHandling;
    send(message: Omit<AgentMessage, 'id' | 'timestamp'>): void;
    request<T = any>(message: Omit<AgentMessage, 'id' | 'timestamp'>, timeoutMs?: number): Promise<T>;
    subscribe(agentId: string, handler: (message: AgentMessage) => void | Promise<void>): void;
    respond(originalMessage: AgentMessage, response: any): void;
    getMessageLog(filter?: {
        source?: string;
        target?: string;
        type?: string;
        since?: Date;
    }): AgentMessage[];
    clearMessageLog(): void;
}
//# sourceMappingURL=message-bus.d.ts.map