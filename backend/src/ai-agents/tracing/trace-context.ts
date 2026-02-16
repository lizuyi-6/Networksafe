/**
 * Trace Context - L3: Scene Traversal Layer
 * Distributed tracing context and attack narrative construction
 */

import { v4 as uuidv4 } from 'uuid';
import {
    TraceContext,
    AttackNarrative,
    NarrativeEvent,
    AttackChainStep,
    TrafficRequest
} from '../core/types';
import logger from '../../utils/logger';

export interface LogEntry {
    timestamp: Date;
    service: string;
    level: 'info' | 'warning' | 'error' | 'critical';
    message: string;
    metadata: Record<string, any>;
    traceId?: string;
    spanId?: string;
}

export interface ServiceNode {
    name: string;
    type: 'frontend' | 'api' | 'database' | 'cache' | 'external';
    logs: LogEntry[];
}

export class TraceContextManager {
    private activeTraces: Map<string, TraceContext[]> = new Map();
    private narratives: Map<string, AttackNarrative> = new Map();
    private serviceNodes: Map<string, ServiceNode> = new Map();
    private maxTraceAge: number = 3600000;

    constructor() {
        this.startCleanupTimer();
    }

    createTraceContext(
        service: string,
        parentContext?: TraceContext
    ): TraceContext {
        const traceId = parentContext?.traceId || uuidv4();
        const spanId = uuidv4();

        return {
            traceId,
            spanId,
            parentSpanId: parentContext?.spanId,
            service,
            timestamp: new Date(),
            tags: {}
        };
    }

    addTraceEvent(
        traceId: string,
        event: {
            service: string;
            event: string;
            severity: NarrativeEvent['severity'];
            rawLog?: string;
        }
    ): void {
        const traces = this.activeTraces.get(traceId) || [];
        
        const context: TraceContext = {
            traceId,
            spanId: uuidv4(),
            service: event.service,
            timestamp: new Date(),
            tags: { event: event.event, severity: event.severity }
        };

        traces.push(context);
        this.activeTraces.set(traceId, traces);

        this.addServiceLog(event.service, {
            timestamp: new Date(),
            service: event.service,
            level: event.severity === 'critical' ? 'critical' : 
                   event.severity === 'error' ? 'error' :
                   event.severity === 'warning' ? 'warning' : 'info',
            message: event.event,
            metadata: {},
            traceId,
            spanId: context.spanId
        });
    }

    addServiceLog(service: string, log: LogEntry): void {
        if (!this.serviceNodes.has(service)) {
            this.serviceNodes.set(service, {
                name: service,
                type: this.inferServiceType(service),
                logs: []
            });
        }

        this.serviceNodes.get(service)!.logs.push(log);
    }

    private inferServiceType(service: string): ServiceNode['type'] {
        const lowerService = service.toLowerCase();
        
        if (lowerService.includes('frontend') || lowerService.includes('web') || lowerService.includes('ui')) {
            return 'frontend';
        }
        if (lowerService.includes('db') || lowerService.includes('database') || lowerService.includes('sql')) {
            return 'database';
        }
        if (lowerService.includes('cache') || lowerService.includes('redis')) {
            return 'cache';
        }
        if (lowerService.includes('external') || lowerService.includes('third')) {
            return 'external';
        }
        return 'api';
    }

    buildAttackNarrative(traceId: string): AttackNarrative {
        const traces = this.activeTraces.get(traceId) || [];
        
        if (traces.length === 0) {
            return this.createEmptyNarrative(traceId);
        }

        const timeline: NarrativeEvent[] = traces.map(t => ({
            timestamp: t.timestamp,
            service: t.service,
            event: t.tags['event'] || 'unknown',
            severity: (t.tags['severity'] as NarrativeEvent['severity']) || 'info',
            correlationId: t.spanId,
            rawLog: t.tags['rawLog']
        }));

        timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        const services = [...new Set(traces.map(t => t.service))];
        const attackChain = this.constructAttackChain(traces);
        const summary = this.generateSummary(timeline, attackChain);
        const riskLevel = this.assessRiskLevel(timeline, attackChain);

        const narrative: AttackNarrative = {
            id: uuidv4(),
            traceId,
            timeline,
            services,
            attackChain,
            summary,
            riskLevel
        };

        this.narratives.set(traceId, narrative);
        return narrative;
    }

    private constructAttackChain(traces: TraceContext[]): AttackChainStep[] {
        const chain: AttackChainStep[] = [];
        const sortedTraces = [...traces].sort((a, b) => 
            a.timestamp.getTime() - b.timestamp.getTime()
        );

        let order = 1;
        for (let i = 0; i < sortedTraces.length; i++) {
            const trace = sortedTraces[i];
            const event = trace.tags['event'] || '';
            const severity = trace.tags['severity'] || 'info';

            if (severity === 'critical' || severity === 'error' || 
                event.toLowerCase().includes('attack') ||
                event.toLowerCase().includes('injection') ||
                event.toLowerCase().includes('unauthorized')) {
                
                chain.push({
                    order: order++,
                    service: trace.service,
                    action: event,
                    payload: trace.tags['payload'],
                    result: severity === 'critical' ? 'success' : 
                            severity === 'error' ? 'failure' : 'blocked',
                    nextStep: order
                });
            }
        }

        return chain;
    }

    private generateSummary(timeline: NarrativeEvent[], attackChain: AttackChainStep[]): string {
        if (attackChain.length === 0) {
            return 'No attack pattern detected in the trace.';
        }

        const services = [...new Set(attackChain.map(s => s.service))];
        const actions = attackChain.map(s => s.action);

        return `Attack narrative spanning ${services.length} service(s): ${services.join(' → ')}. ` +
               `Key actions: ${actions.slice(0, 3).join(', ')}${actions.length > 3 ? '...' : ''}. ` +
               `${attackChain.filter(s => s.result === 'success').length} step(s) succeeded, ` +
               `${attackChain.filter(s => s.result === 'blocked').length} step(s) blocked.`;
    }

    private assessRiskLevel(
        timeline: NarrativeEvent[], 
        attackChain: AttackChainStep[]
    ): 'low' | 'medium' | 'high' | 'critical' {
        const criticalEvents = timeline.filter(e => e.severity === 'critical').length;
        const errorEvents = timeline.filter(e => e.severity === 'error').length;
        const successfulSteps = attackChain.filter(s => s.result === 'success').length;

        if (criticalEvents > 0 || successfulSteps > 2) {
            return 'critical';
        }
        if (errorEvents > 2 || successfulSteps > 0) {
            return 'high';
        }
        if (errorEvents > 0 || attackChain.length > 1) {
            return 'medium';
        }
        return 'low';
    }

    private createEmptyNarrative(traceId: string): AttackNarrative {
        return {
            id: uuidv4(),
            traceId,
            timeline: [],
            services: [],
            attackChain: [],
            summary: 'No trace data available.',
            riskLevel: 'low'
        };
    }

    correlateLogs(
        logs: LogEntry[],
        timeWindow: number = 60000
    ): Map<string, LogEntry[]> {
        const correlated = new Map<string, LogEntry[]>();

        for (const log of logs) {
            if (!log.traceId) continue;

            const group = correlated.get(log.traceId) || [];
            group.push(log);
            correlated.set(log.traceId, group);
        }

        for (const [traceId, entries] of correlated) {
            entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        }

        return correlated;
    }

    getRelatedRequests(traceId: string): TrafficRequest[] {
        const traces = this.activeTraces.get(traceId) || [];
        
        return traces
            .filter(t => t.tags['request'])
            .map(t => t.tags['request'] as unknown as TrafficRequest);
    }

    getNarrative(traceId: string): AttackNarrative | undefined {
        return this.narratives.get(traceId);
    }

    getTraceContext(traceId: string): TraceContext[] | undefined {
        return this.activeTraces.get(traceId);
    }

    private startCleanupTimer(): void {
        setInterval(() => {
            this.cleanupStaleTraces();
        }, 300000);
    }

    private cleanupStaleTraces(): void {
        const now = Date.now();
        
        for (const [traceId, traces] of this.activeTraces) {
            const lastTrace = traces[traces.length - 1];
            if (lastTrace && now - lastTrace.timestamp.getTime() > this.maxTraceAge) {
                this.activeTraces.delete(traceId);
            }
        }

        for (const [serviceName, node] of this.serviceNodes) {
            node.logs = node.logs.filter(log => 
                now - log.timestamp.getTime() < this.maxTraceAge
            );
        }
    }

    getStats(): {
        activeTraces: number;
        narratives: number;
        services: number;
    } {
        return {
            activeTraces: this.activeTraces.size,
            narratives: this.narratives.size,
            services: this.serviceNodes.size
        };
    }
}

export const traceContextManager = new TraceContextManager();
