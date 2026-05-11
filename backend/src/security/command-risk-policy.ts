export type RiskClass = 'auto' | 'admin_approval_required' | 'physical_confirmation_required';

const PHYSICAL_CONFIRMATION_COMMANDS = new Set([
  'reboot',
  'restart',
  'host_remove',
  'host_uninstall',
  'uninstall',
  'remove_agent',
  'wipe_data',
  'wipe',
  'factory_reset',
  'recovery_flash',
  'firmware_flash',
  'ota_update',
  'deploy_bundle',
  'critical_config_change',
  'diagnostic_unlock',
  'interlock_assert',
  'interlock_release',
  'cellular_breaker_assert',
  'cellular_breaker_release',
  'vehicle_ota_flash',
  'delete_data',
  'purge_data'
]);

const ADMIN_APPROVAL_COMMANDS = new Set([
  'host_install',
  'install_agent',
  'update_rules'
]);

const AUTO_COMMANDS = new Set([
  'scan',
  'block_ip',
  'unblock_ip',
  'collect',
  'sync-config',
  'sync_config',
  'host_backup'
]);

export function normalizeCommandType(commandType: string): string {
  return String(commandType || '').trim().replace(/-/g, '_').toLowerCase();
}

export function classifyCommandRisk(commandType: string): RiskClass {
  const normalized = normalizeCommandType(commandType);
  if (PHYSICAL_CONFIRMATION_COMMANDS.has(normalized)) {
    return 'physical_confirmation_required';
  }
  if (ADMIN_APPROVAL_COMMANDS.has(normalized)) {
    return 'admin_approval_required';
  }
  if (AUTO_COMMANDS.has(normalized)) {
    return 'auto';
  }
  return 'admin_approval_required';
}

export function requiresPhysicalConfirmation(commandType: string): boolean {
  return classifyCommandRisk(commandType) === 'physical_confirmation_required';
}

export function isAutoCommand(commandType: string): boolean {
  return classifyCommandRisk(commandType) === 'auto';
}
