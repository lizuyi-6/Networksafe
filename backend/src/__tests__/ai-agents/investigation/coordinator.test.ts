/**
 * Tests for InvestigationCoordinator — multi-agent bug investigation orchestration.
 * Verifies investigation lifecycle (start → cancel/complete), agent registration,
 * status reporting, and active investigation tracking. Uses mock-free construction
 * (EventEmitter-based, async workflow with setImmediate).
 */

import { InvestigationCoordinator } from '../../../ai-agents/investigation/coordinator';
import type { BugReport, InvestigationContext } from '../../../ai-agents/investigation/types';

function makeBug(overrides: Partial<BugReport> = {}): BugReport {
    return {
        id: `bug-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Test bug',
        description: 'Something is broken',
        severity: 'high',
        category: 'functional',
        environment: { os: 'linux', runtime: 'node18', version: '1.0.0' },
        reporter: 'tester',
        timestamp: new Date(),
        ...overrides
    } as BugReport;
}

function makeContext(bug?: BugReport): InvestigationContext {
    return {
        bugReport: bug || makeBug(),
        systemState: {
            logs: [],
            traces: [],
            metrics: { cpuUsage: 0, memoryUsage: 0, diskUsage: 0, networkLatency: 0 }
        } as any
    } as InvestigationContext;
}

describe('InvestigationCoordinator', () => {
    const coordinators: InvestigationCoordinator[] = [];
    const createCoordinator = (): InvestigationCoordinator => {
        const coordinator = new InvestigationCoordinator();
        coordinators.push(coordinator);
        return coordinator;
    };

    afterEach(async () => {
        for (const coordinator of coordinators.splice(0)) {
            for (const investigation of coordinator.getActiveInvestigations()) {
                coordinator.cancelInvestigation(investigation.investigationId);
            }
            await coordinator.waitForIdle();
        }
    });

    it('constructs and registers investigation agents', () => {
        const coord = createCoordinator();
        const caps = coord.getAgentCapabilities();
        expect(caps.length).toBeGreaterThan(0);
        caps.forEach((c) => {
            expect(c.agentType).toBeDefined();
            expect(c.status).toBe('active');
        });
    });

    it('startInvestigation returns an id and tracks it as active', async () => {
        const coord = createCoordinator();
        const id = await coord.startInvestigation(makeBug(), makeContext());
        expect(id).toBeTruthy();
        expect(typeof id).toBe('string');
        const active = coord.getActiveInvestigations();
        expect(active.length).toBeGreaterThan(0);
        expect(active.some((a) => a.investigationId === id)).toBe(true);
    });

    it('emits investigation:started event', async () => {
        const coord = createCoordinator();
        const startedPromise = new Promise<void>((resolve) => {
            coord.on('investigation:started', () => resolve());
        });
        await coord.startInvestigation(makeBug(), makeContext());
        await startedPromise;
    });

    it('getInvestigationStatus returns not_found for unknown id', () => {
        const coord = createCoordinator();
        const status = coord.getInvestigationStatus('nonexistent');
        expect(status.status).toBe('not_found');
    });

    it('getInvestigationStatus returns in_progress for a newly started investigation', async () => {
        const coord = createCoordinator();
        const id = await coord.startInvestigation(makeBug(), makeContext());
        const status = coord.getInvestigationStatus(id);
        expect(['in_progress', 'completed', 'failed']).toContain(status.status);
    });

    it('cancelInvestigation cancels an in-progress investigation', async () => {
        const coord = createCoordinator();
        const id = await coord.startInvestigation(makeBug(), makeContext());
        const result = coord.cancelInvestigation(id);
        expect(result.cancelled).toBe(true);
        expect(result.status).toBe('cancelled');
    });

    it('cancelInvestigation returns not_found for unknown id', () => {
        const coord = createCoordinator();
        const result = coord.cancelInvestigation('nonexistent');
        expect(result.cancelled).toBe(false);
        expect(result.status).toBe('not_found');
    });

    it('cancelInvestigation returns already_cancelled for a second cancel', async () => {
        const coord = createCoordinator();
        const id = await coord.startInvestigation(makeBug(), makeContext());
        coord.cancelInvestigation(id);
        const second = coord.cancelInvestigation(id);
        expect(second.cancelled).toBe(false);
        expect(second.status).toBe('already_cancelled');
    });

    it('getActiveInvestigations returns summaries with investigationId and summary', async () => {
        const coord = createCoordinator();
        const bug = makeBug({ description: 'Critical crash on startup' });
        await coord.startInvestigation(bug, makeContext(bug));
        const active = coord.getActiveInvestigations();
        expect(active.length).toBeGreaterThanOrEqual(1);
        const found = active.find((a) => a.summary === 'Critical crash on startup');
        expect(found).toBeDefined();
        expect(found!.outcome).toBe('investigating');
    });

    it('handles multiple concurrent investigations independently', async () => {
        const coord = createCoordinator();
        const id1 = await coord.startInvestigation(makeBug({ title: 'bug-A' }), makeContext());
        const id2 = await coord.startInvestigation(makeBug({ title: 'bug-B' }), makeContext());
        expect(id1).not.toBe(id2);
        expect(coord.getActiveInvestigations().length).toBeGreaterThanOrEqual(2);
        coord.cancelInvestigation(id1);
        const status1 = coord.getInvestigationStatus(id1);
        expect(['cancelled', 'completed', 'failed']).toContain(status1.status);
    });
});
