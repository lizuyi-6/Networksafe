/**
 * Tests for alert-state.service — severity normalization + addAlert delegation.
 * addAlert delegates to securityOperationsService, so we mock it and assert the
 * contract (severity mapping, tenant fallback, asset upsert wiring).
 */

jest.mock('../../services/security-operations.service', () => ({
    securityOperationsService: {
        upsertAsset: jest.fn(() => ({ assetId: 'asset-1' })),
        createAlert: jest.fn((input) => ({ alertId: 'alert-1', ...input }))
    }
}));

import { severityToInternal, addAlert } from '../../services/alert-state.service';
import { securityOperationsService } from '../../services/security-operations.service';

const mockedUpsertAsset = securityOperationsService.upsertAsset as jest.Mock;
const mockedCreateAlert = securityOperationsService.createAlert as jest.Mock;

describe('alert-state service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('severityToInternal', () => {
        it('maps canonical severities through', () => {
            expect(severityToInternal('Critical')).toBe('critical');
            expect(severityToInternal('High')).toBe('high');
            expect(severityToInternal('Medium')).toBe('medium');
            expect(severityToInternal('Low')).toBe('low');
        });

        it('is case-insensitive', () => {
            expect(severityToInternal('CRITICAL')).toBe('critical');
            expect(severityToInternal('hIgH')).toBe('high');
        });

        it('falls back to medium for unknown / missing severity', () => {
            expect(severityToInternal('severe')).toBe('medium');
            expect(severityToInternal('')).toBe('medium');
            expect(severityToInternal('whatever')).toBe('medium');
        });
    });

    describe('addAlert', () => {
        const baseAlert = {
            title: 'Suspicious login',
            message: 'Multiple failed logins',
            severity: 'High' as const,
            type: 'security' as const,
            source: 'auth-monitor'
        };

        it('delegates to securityOperationsService with mapped severity and platform tenant fallback', () => {
            addAlert(baseAlert);
            expect(mockedCreateAlert).toHaveBeenCalledTimes(1);
            const arg = mockedCreateAlert.mock.calls[0][0];
            expect(arg.severity).toBe('high');
            expect(arg.title).toBe('Suspicious login');
            expect(arg.alertType).toBe('security');
            expect(arg.sourceType).toBe('system');
            expect(arg.tenantId).toBeDefined(); // falls back to platform tenant
            // No assetRef -> no upsert
            expect(mockedUpsertAsset).not.toHaveBeenCalled();
        });

        it('upserts an asset when assetRef is provided and links it', () => {
            addAlert({ ...baseAlert, assetRef: '10.0.0.5', tenantId: 'tenant-9' });
            expect(mockedUpsertAsset).toHaveBeenCalledTimes(1);
            const assetArg = mockedUpsertAsset.mock.calls[0][0];
            expect(assetArg.externalRef).toBe('10.0.0.5');
            expect(assetArg.tenantId).toBe('tenant-9');
            const alertArg = mockedCreateAlert.mock.calls[0][0];
            expect(alertArg.tenantId).toBe('tenant-9');
            expect(alertArg.assetId).toBe('asset-1');
        });

        it('maps a critical severity through end to end', () => {
            addAlert({ ...baseAlert, severity: 'Critical' });
            expect(mockedCreateAlert.mock.calls[0][0].severity).toBe('critical');
        });

        it('maps an unknown severity to medium end to end', () => {
            addAlert({ ...baseAlert, severity: 'Catastrophic' as any });
            expect(mockedCreateAlert.mock.calls[0][0].severity).toBe('medium');
        });
    });
});
