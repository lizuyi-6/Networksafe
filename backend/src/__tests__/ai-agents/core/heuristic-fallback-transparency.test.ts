/**
 * Degradation transparency (Athens Academy): a role agent that answers via
 * its heuristic fallback (model unreachable / heuristicOnly) must mark the
 * result heuristicFallback=true and must NOT claim a model tier. Before this
 * invariant existed the fallback labelled itself modelTier:'cloud', so a
 * regex verdict was indistinguishable from a cloud-model verdict downstream.
 */
import { PlatoAgent } from '../../../ai-agents/roles/plato-agent';
import { SocratesAgent } from '../../../ai-agents/roles/socrates-agent';
import { AristotleAgent } from '../../../ai-agents/roles/aristotle-agent';
import type { AgentConfig, TrafficContext } from '../../../ai-agents/core/types';

function agentConfig(id: string, role: AgentConfig['identity']['role']): AgentConfig {
    return {
        identity: {
            id,
            role,
            team: 'analyst',
            name: id,
            description: 'test agent',
            capabilities: []
        },
        modelConfig: {
            provider: 'ollama',
            model: 'test-model',
            temperature: 0,
            maxTokens: 512
        },
        timeout: 1000,
        maxRetries: 0,
        // Forces callModel to throw heuristic_fallback_enabled → fallback path.
        heuristicOnly: true
    };
}

function mockBus(): any {
    return {
        subscribe: jest.fn().mockReturnValue(() => undefined),
        publish: jest.fn(),
        requestModel: jest.fn().mockRejectedValue(new Error('model unreachable')),
        getStats: jest.fn().mockReturnValue({ queueSize: 0, subscriptionCount: 0, pendingRequests: 0 })
    };
}

function trafficContext(): TrafficContext {
    return {
        request: {
            id: 'req-fallback-1',
            timestamp: new Date(),
            sourceIP: '127.0.0.1',
            method: 'GET',
            path: '/api/items?q=1',
            headers: { 'user-agent': 'jest' },
            queryParams: { q: '1' }
        },
        history: [],
        relatedRequests: []
    } as unknown as TrafficContext;
}

describe('role agents mark heuristic fallback results', () => {
    it.each([
        ['plato', () => new PlatoAgent(agentConfig('plato-t', 'plato'), mockBus())],
        ['socrates', () => new SocratesAgent(agentConfig('socrates-t', 'socrates'), mockBus())],
        ['aristotle', () => new AristotleAgent(agentConfig('aristotle-t', 'aristotle'), mockBus())]
    ])('%s fallback result is marked and claims no model tier', async (_name, make) => {
        const agent = make();
        const result = await agent.analyze(trafficContext());
        expect(result.heuristicFallback).toBe(true);
        expect(result.modelTier).toBeUndefined();
    });
});
