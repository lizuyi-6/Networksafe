/**
 * Message Bus - Inter-Agent Communication System
 * L1: Collaboration Layer - Message Routing
 */

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import {
    AgentMessage,
    AgentRole,
    ModelRequest,
    ModelResponse,
    MessageEnvelope
} from './types';
import logger from '../../utils/logger';

export type MessageHandler = (message: AgentMessage) => Promise<void>;
export type ModelRequestHandler = (request: ModelRequest) => Promise<ModelResponse>;

interface Subscription {
    id: string;
    role: AgentRole;
    handler: MessageHandler;
}

interface PendingRequest {
    resolve: (response: ModelResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}

const MESSAGE_EVENT = 'message_queued';
const SHUTDOWN_EVENT = 'shutdown';

export class MessageBus extends EventEmitter {
    private subscriptions: Map<AgentRole, Subscription[]> = new Map();
    private messageQueue: MessageEnvelope[] = [];
    private pendingModelRequests: Map<string, PendingRequest> = new Map();
    private modelRequestHandler: ModelRequestHandler | null = null;
    private isProcessing: boolean = false;
    private maxQueueSize: number = 10000;
    private defaultTTL: number = 60000;
    private maxRetries: number = 3;
    private processingPromise: Promise<void> | null = null;
    private processingTimeout: NodeJS.Timeout | null = null;
    private readonly PROCESSING_TIMEOUT_MS: number = 30000;

    constructor() {
        super();
        this.setMaxListeners(100);
        this.startProcessing();
    }

    subscribe(role: AgentRole, handler: MessageHandler): () => void {
        const subscriptionId = uuidv4();
        const subscription: Subscription = {
            id: subscriptionId,
            role,
            handler
        };

        if (!this.subscriptions.has(role)) {
            this.subscriptions.set(role, []);
        }

        this.subscriptions.get(role)!.push(subscription);
        logger.debug(`Subscription added for role: ${role}`);

        return () => {
            const subs = this.subscriptions.get(role);
            if (subs) {
                const index = subs.findIndex(s => s.id === subscriptionId);
                if (index !== -1) {
                    subs.splice(index, 1);
                    logger.debug(`Subscription removed for role: ${role}`);
                }
            }
        };
    }

    async publish(message: AgentMessage): Promise<void> {
        if (this.messageQueue.length >= this.maxQueueSize) {
            logger.warn('Message queue full, dropping oldest messages');
            this.messageQueue = this.messageQueue.slice(-this.maxQueueSize / 2);
        }

        const envelope: MessageEnvelope = {
            message,
            routingKey: this.createRoutingKey(message),
            ttl: this.defaultTTL,
            retryCount: 0
        };

        this.messageQueue.push(envelope);
        logger.debug(`Message published: ${message.type} from ${message.from} to ${message.to}`);
        
        this.emit(MESSAGE_EVENT);
    }

    async publishDirect(role: AgentRole, message: AgentMessage): Promise<void> {
        const subscriptions = this.subscriptions.get(role);
        if (!subscriptions || subscriptions.length === 0) {
            logger.warn(`No subscribers for role: ${role}`);
            return;
        }

        for (const subscription of subscriptions) {
            try {
                await subscription.handler(message);
            } catch (error: any) {
                logger.error(`Error in message handler for ${role}`, { error: error.message });
            }
        }
    }

    setModelRequestHandler(handler: ModelRequestHandler): void {
        this.modelRequestHandler = handler;
    }

    async requestModel(request: ModelRequest): Promise<ModelResponse> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingModelRequests.delete(request.id);
                reject(new Error(`Model request timeout: ${request.id}`));
            }, request.timeout);

            this.pendingModelRequests.set(request.id, {
                resolve,
                reject,
                timeout
            });

            this.processModelRequest(request).catch(error => {
                clearTimeout(timeout);
                this.pendingModelRequests.delete(request.id);
                reject(error);
            });
        });
    }

    private async processModelRequest(request: ModelRequest): Promise<void> {
        if (!this.modelRequestHandler) {
            throw new Error('No model request handler registered');
        }

        try {
            const response = await this.modelRequestHandler(request);
            const pending = this.pendingModelRequests.get(request.id);
            if (pending) {
                clearTimeout(pending.timeout);
                pending.resolve(response);
                this.pendingModelRequests.delete(request.id);
            }
        } catch (error: any) {
            const pending = this.pendingModelRequests.get(request.id);
            if (pending) {
                clearTimeout(pending.timeout);
                pending.reject(error);
                this.pendingModelRequests.delete(request.id);
            }
        }
    }

    private startProcessing(): void {
        this.isProcessing = true;
        this.processingPromise = this.processQueue();
    }

    private async processQueue(): Promise<void> {
        while (this.isProcessing) {
            while (this.messageQueue.length > 0) {
                const envelope = this.messageQueue.shift();
                if (!envelope) continue;

                if (this.isExpired(envelope)) {
                    logger.debug(`Message expired: ${envelope.message.id}`);
                    continue;
                }

                await this.deliverMessage(envelope);
            }

            if (!this.isProcessing) break;

            try {
                await this.waitForNewMessage();
            } catch (error) {
                if (this.isProcessing) {
                    logger.debug('Message queue wait interrupted, continuing processing');
                }
                break;
            }
        }
    }

    private waitForNewMessage(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.removeListener(MESSAGE_EVENT, onMessage);
                this.removeListener(SHUTDOWN_EVENT, onShutdown);
                if (this.isProcessing) {
                    resolve();
                } else {
                    reject(new Error('Shutdown'));
                }
            }, this.PROCESSING_TIMEOUT_MS);

            const onMessage = () => {
                clearTimeout(timeoutId);
                this.removeListener(SHUTDOWN_EVENT, onShutdown);
                resolve();
            };

            const onShutdown = () => {
                clearTimeout(timeoutId);
                this.removeListener(MESSAGE_EVENT, onMessage);
                reject(new Error('Shutdown'));
            };

            this.once(MESSAGE_EVENT, onMessage);
            this.once(SHUTDOWN_EVENT, onShutdown);
        });
    }

    private async deliverMessage(envelope: MessageEnvelope): Promise<void> {
        const { message } = envelope;
        const targetRoles = message.to === 'broadcast' 
            ? Array.from(this.subscriptions.keys())
            : [message.to as AgentRole];

        for (const role of targetRoles) {
            const subscriptions = this.subscriptions.get(role);
            if (!subscriptions) continue;

            for (const subscription of subscriptions) {
                try {
                    await subscription.handler(message);
                } catch (error: any) {
                    logger.error(`Failed to deliver message to ${role}`, {
                        error: error.message,
                        messageId: message.id
                    });

                    if (envelope.retryCount < this.maxRetries) {
                        envelope.retryCount++;
                        this.messageQueue.unshift(envelope);
                        logger.debug(`Retrying message delivery (attempt ${envelope.retryCount})`);
                    }
                }
            }
        }
    }

    private createRoutingKey(message: AgentMessage): string {
        return `${message.type}.${message.from}.${message.to}`;
    }

    private isExpired(envelope: MessageEnvelope): boolean {
        const age = Date.now() - envelope.message.timestamp.getTime();
        return age > envelope.ttl;
    }

    shutdown(): void {
        this.isProcessing = false;
        this.emit(SHUTDOWN_EVENT);
        
        if (this.processingTimeout) {
            clearTimeout(this.processingTimeout);
            this.processingTimeout = null;
        }

        this.subscriptions.clear();
        this.messageQueue = [];

        for (const [, pending] of this.pendingModelRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Message bus shutdown'));
        }
        this.pendingModelRequests.clear();

        this.removeAllListeners();

        logger.info('Message bus shutdown complete');
    }

    getStats(): {
        queueSize: number;
        subscriptionCount: number;
        pendingRequests: number;
    } {
        let totalSubscriptions = 0;
        for (const subs of this.subscriptions.values()) {
            totalSubscriptions += subs.length;
        }

        return {
            queueSize: this.messageQueue.length,
            subscriptionCount: totalSubscriptions,
            pendingRequests: this.pendingModelRequests.size
        };
    }
}

export const globalMessageBus = new MessageBus();
