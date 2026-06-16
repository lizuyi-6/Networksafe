/**
 * Tests for command-risk-policy — the command risk classifier that decides which
 * commands require physical confirmation, admin approval, or run automatically.
 * Security-critical: misclassification could let a destructive command bypass
 * the hardware gate, or block a benign one.
 */

import {
    normalizeCommandType,
    classifyCommandRisk,
    requiresPhysicalConfirmation,
    isAutoCommand,
    type RiskClass
} from '../../security/command-risk-policy';

describe('command-risk-policy', () => {
    describe('normalizeCommandType', () => {
        it('trims, lowercases, and converts hyphens to underscores', () => {
            expect(normalizeCommandType('Factory-Reset')).toBe('factory_reset');
            expect(normalizeCommandType('  BLOCK_IP ')).toBe('block_ip');
            expect(normalizeCommandType('host-remove')).toBe('host_remove');
        });
        it('returns empty string for nullish input', () => {
            expect(normalizeCommandType('')).toBe('');
            expect(normalizeCommandType(null as any)).toBe('');
            expect(normalizeCommandType(undefined as any)).toBe('');
        });
    });

    describe('classifyCommandRisk — physical confirmation required', () => {
        const physical: Array<[string, string]> = [
            ['reboot', 'reboot'],
            ['wipe_data', 'data wipe'],
            ['factory_reset', 'factory reset'],
            ['recovery_flash', 'recovery flash'],
            ['host_remove', 'host removal'],
            ['critical_config_change', 'critical config'],
            ['interlock_assert', 'interlock assert'],
            ['vehicle_ota_flash', 'vehicle OTA']
        ];
        for (const [cmd] of physical) {
            it(`${cmd} requires physical confirmation`, () => {
                expect(classifyCommandRisk(cmd)).toBe<RiskClass>('physical_confirmation_required');
                expect(requiresPhysicalConfirmation(cmd)).toBe(true);
            });
        }
        // Hyphenated form must normalize to the same class.
        it('factory-reset (hyphenated) still requires physical confirmation', () => {
            expect(requiresPhysicalConfirmation('factory-reset')).toBe(true);
        });
    });

    describe('classifyCommandRisk — admin approval required', () => {
        it('classifies admin-approval commands', () => {
            expect(classifyCommandRisk('host_install')).toBe<RiskClass>('admin_approval_required');
            expect(classifyCommandRisk('install_agent')).toBe<RiskClass>('admin_approval_required');
            expect(classifyCommandRisk('update_rules')).toBe<RiskClass>('admin_approval_required');
        });
    });

    describe('classifyCommandRisk — auto', () => {
        it('classifies auto commands and isAutoCommand agrees', () => {
            for (const cmd of ['scan', 'block_ip', 'unblock_ip', 'collect', 'sync-config', 'host_backup']) {
                expect(classifyCommandRisk(cmd)).toBe<RiskClass>('auto');
                expect(isAutoCommand(cmd)).toBe(true);
            }
        });
        it('accepts both sync-config and sync_config forms', () => {
            expect(isAutoCommand('sync-config')).toBe(true);
            expect(isAutoCommand('sync_config')).toBe(true);
        });
    });

    describe('classifyCommandRisk — default for unknown commands', () => {
        it('defaults unknown commands to admin_approval_required (fail-safe)', () => {
            expect(classifyCommandRisk('totally_unknown_command')).toBe<RiskClass>('admin_approval_required');
            expect(classifyCommandRisk('')).toBe<RiskClass>('admin_approval_required');
        });
        it('does not require physical confirmation for unknown commands', () => {
            expect(requiresPhysicalConfirmation('some_new_command')).toBe(false);
        });
    });

    describe('requiresPhysicalConfirmation vs isAutoCommand mutual exclusivity', () => {
        it('a command is never both auto and physical-confirmation', () => {
            const all = ['scan', 'reboot', 'host_install', 'factory_reset', 'block_ip', 'wipe_data', 'unknown_cmd'];
            for (const cmd of all) {
                expect(requiresPhysicalConfirmation(cmd) && isAutoCommand(cmd)).toBe(false);
            }
        });
    });
});
