/**
 * Message Bus - Inter-Agent Communication System
 * L1: Collaboration Layer - Message Routing
 *
 * SECURITY (V12.18): cross-tenant defense + envelope signing.
 *  - publish() signs the envelope (HMAC-SHA256 over canonical
 *    message + tenant tag) and tags it with the active tenant.
 *  - deliverMessage() drops envelopes with a missing, invalid, or
 *    cross-tenant signature.
 *  - In production the module refuses to load without a signing key
 *    (MESSAGE_BUS_SIGNING_KEY or AUDIT_LOG_SECRET); in non-production
 *    it falls back to a per-process random key.
 */

import { uuidv4 } from '../../utils/uuid';
import { EventEmitter } from 'events';
import crypto from 'crypto';
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

/**
 * Resolve the HMAC signing key for envelope signatures.
 *
 * Production MUST supply MESSAGE_BUS_SIGNING_KEY (or fall back to
 * AUDIT_LOG_SECRET). Non-production environments get a per-process
 * random key so dev / test still has signature integrity without
 * forcing operators to set a secret.
 */
function resolveSigningKey(): string {
    const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const explicit = process.env.MESSAGE_BUS_SIGNING_KEY || process.env.AUDIT_LOG_SECRET;
    if (explicit && typeof explicit === 'string' && explicit.length > 0) {
        return explicit;
    }
    if (isProduction) {
        throw new Error(
            'MESSAGE_BUS_SIGNING_KEY environment variable is not set. '
            + 'Set MESSAGE_BUS_SIGNING_KEY (or AUDIT_LOG_SECRET) before starting the control plane in production.'
        );
    }
    // Dev/test fallback — random per-process key. Preserves signature
    // integrity within a single run without forcing a secret.
    return crypto.randomBytes(32).toString('hex');
}

const SIGNING_KEY = resolveSigningKey();

function canonicalMessageString(message: AgentMessage, tenantId: string | undefined): string {
    return [
        message.id,
        message.type,
        message.from,
        message.to,
        JSON.stringify(message.payload || {})
    ].join('|') + '|' + (tenantId || '');
}

function signEnvelope(envelope: MessageEnvelope): string {
    const canonical = canonicalMessageString(envelope.message, envelope.tenantId);
    return crypto.createHmac('sha256', SIGNING_KEY).update(canonical).digest('hex');
}

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

    /**
     * SECURITY (V12.18): active tenant tag. Once bound (typically at
     * request-scope setup), all subsequently published envelopes carry
     * it and only same-tenant subscribers receive them. Re-binding to a
     * DIFFERENT tenant is refused — the first binding wins — so a
     * compromised mid-pipeline agent cannot retag its messages.
     */
    private activeTenantId: string | undefined;
    private tenantBindingLocked: boolean = false;

    constructor() {
        super();
        this.setMaxListeners(100);
        this.startProcessing();
    }

    /**
     * Bind this bus instance to a tenant scope. The FIRST binding wins;
     * subsequent calls to a different tenant are ignored (fail-still).
     * Returns the currently active tenant id.
     */
    bindTenant(tenantId: string): string {
        if (!this.tenantBindingLocked) {
            this.activeTenantId = tenantId;
            this.tenantBindingLocked = true;
            logger.debug(`MessageBus bound to tenant: ${tenantId}`);
        } else if (this.activeTenantId !== tenantId) {
            logger.warn(
                `MessageBus refused tenant rebind: active=${this.activeTenantId} requested=${tenantId}`
            );
        }
        return this.activeTenantId!;
    }

    getActiveTenantId(): string | undefined {
        return this.activeTenantId;
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
            retryCount: 0,
            tenantId: this.activeTenantId
        };
        envelope.signature = signEnvelope(envelope);

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

                // SECURITY (V12.18): drop forged or cross-tenant envelopes
                // before any subscriber sees them.
                if (!this.isEnvelopeAuthorized(envelope)) {
                    logger.warn('Dropping unauthorized message bus envelope', {
                        messageId: envelope.message.id,
                        reason: 'signature_or_tenant_mismatch'
                    });
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

    /**
     * SECURITY (V12.18): an envelope is deliverable only when:
     *   1. it carries a signature that recomputes against its current
     *      message + tenant tag (tamper protection), AND
     *   2. its tenant tag matches this bus's active tenant (or both
     *      are undefined — platform scope).
     */
    private isEnvelopeAuthorized(envelope: MessageEnvelope): boolean {
        const expected = signEnvelope(envelope);
        if (!envelope.signature || envelope.signature !== expected) {
            return false;
        }
        if (this.activeTenantId && envelope.tenantId !== this.activeTenantId) {
            return false;
        }
        return true;
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

            if (typeof timeoutId.unref === 'function') {
                timeoutId.unref();
            }
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
                        // Re-sign so the retried envelope still passes the
                        // authorization check (retryCount is not in the
                        // canonical string, so signature is unchanged).
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
