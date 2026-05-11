/**
 * Command Dispatcher Service Tests
 */

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }
}));

jest.mock('../../security/audit-logger.service', () => ({
  __esModule: true,
  default: {
    log: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../services/security-operations.service', () => ({
  securityOperationsService: {
    recordActionRun: jest.fn(),
    updateActionRun: jest.fn(),
  },
}));

jest.mock('../../services/hardware-authorization.service', () => ({
  hardwareAuthorizationService: {
    requestPhysicalConfirmation: jest.fn().mockResolvedValue({
      success: true,
      intent: { actionId: 'action-1' },
      session: { sessionId: 'session-1', gateId: 'gate-1' },
      message: 'waiting',
    }),
    completeIntent: jest.fn(),
    setGatewayEmitter: jest.fn(),
    prepare: jest.fn(),
  },
}));

import { commandDispatcherService } from '../../services/command-dispatcher.service';
import auditLogger from '../../security/audit-logger.service';
import { securityOperationsService } from '../../services/security-operations.service';
import { hardwareAuthorizationService } from '../../services/hardware-authorization.service';

const mockAuditLog = auditLogger.log as jest.Mock;
const mockRecordActionRun = securityOperationsService.recordActionRun as jest.Mock;
const mockUpdateActionRun = securityOperationsService.updateActionRun as jest.Mock;
const mockRequestPhysicalConfirmation = hardwareAuthorizationService.requestPhysicalConfirmation as jest.Mock;

function createMockAgentGateway(online = true, acceptsCommand = true) {
  return {
    getAgent: jest.fn().mockReturnValue(online ? { id: 'agent-001', status: 'online' } : null),
    sendCommandToAgent: jest.fn().mockReturnValue(acceptsCommand),
  };
}

function createMockDeviceAdapter(online = true, commandResult = { success: true, message: 'OK' }) {
  return {
    getDevice: jest.fn().mockReturnValue({ id: 'device-001', isOnline: online }),
    executeCommand: jest.fn().mockReturnValue(commandResult),
  };
}

const actor = { tenantId: 'tenant-1', userId: 'user-1', email: 'admin@test.com', ip: '127.0.0.1' };

describe('CommandDispatcherService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    commandDispatcherService.setAgentGateway(null);
    commandDispatcherService.setDeviceAdapter(null);
    mockRequestPhysicalConfirmation.mockResolvedValue({
      success: true,
      intent: { actionId: 'action-1' },
      session: { sessionId: 'session-1', gateId: 'gate-1' },
      message: 'waiting',
    });
  });

  describe('dispatchAgentCommand', () => {
    it('returns approval_required for admin-approval commands without approval', async () => {
      commandDispatcherService.setAgentGateway(createMockAgentGateway());
      const result = await commandDispatcherService.dispatchAgentCommand({
        agentId: 'agent-001',
        commandType: 'update_rules',
        actor,
      });
      expect(result.status).toBe('approval_required');
      expect(result.success).toBe(true);
      expect(result.actionId).toBeTruthy();
      expect(mockAuditLog).toHaveBeenCalled();
    });

    it('returns failed when agent gateway is not set', async () => {
      const result = await commandDispatcherService.dispatchAgentCommand({
        agentId: 'agent-001',
        commandType: 'scan',
        actor,
      });
      expect(result.status).toBe('failed');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('agent_not_available');
    });

    it('returns failed when agent is not found', async () => {
      commandDispatcherService.setAgentGateway(createMockAgentGateway(false));
      const result = await commandDispatcherService.dispatchAgentCommand({
        agentId: 'agent-001',
        commandType: 'scan',
        actor,
      });
      expect(result.status).toBe('failed');
      expect(result.reason).toBe('agent_not_available');
    });

    it('dispatches auto-allowed scan command', async () => {
      commandDispatcherService.setAgentGateway(createMockAgentGateway());
      const result = await commandDispatcherService.dispatchAgentCommand({
        agentId: 'agent-001',
        commandType: 'scan',
        actor,
      });
      expect(result.status).toBe('running');
      expect(result.success).toBe(true);
    });

    it('dispatches auto-allowed block_ip command', async () => {
      commandDispatcherService.setAgentGateway(createMockAgentGateway());
      const result = await commandDispatcherService.dispatchAgentCommand({
        agentId: 'agent-001',
        commandType: 'block_ip',
        payload: { ip: '10.0.0.1' },
        actor,
      });
      expect(result.status).toBe('running');
      expect(result.success).toBe(true);
    });

    it('returns failed when agent rejects command', async () => {
      commandDispatcherService.setAgentGateway(createMockAgentGateway(true, false));
      const result = await commandDispatcherService.dispatchAgentCommand({
        agentId: 'agent-001',
        commandType: 'scan',
        actor,
      });
      expect(result.status).toBe('failed');
      expect(result.reason).toBe('dispatch_rejected');
    });

    it('dispatches approved admin-approval command', async () => {
      commandDispatcherService.setAgentGateway(createMockAgentGateway());
      const result = await commandDispatcherService.dispatchAgentCommand({
        agentId: 'agent-001',
        commandType: 'update_rules',
        actor,
        approved: true,
      });
      expect(result.status).toBe('running');
      expect(result.success).toBe(true);
    });
  });

  describe('dispatchDeviceCommand', () => {
    it('returns failed when device adapter is not set', async () => {
      const result = await commandDispatcherService.dispatchDeviceCommand({
        deviceId: 'device-001',
        commandType: 'collect',
        actor,
      });
      expect(result.status).toBe('failed');
      expect(result.reason).toBe('device_not_available');
    });

    it('returns failed when device is offline', async () => {
      commandDispatcherService.setDeviceAdapter(createMockDeviceAdapter(false));
      const result = await commandDispatcherService.dispatchDeviceCommand({
        deviceId: 'device-001',
        commandType: 'collect',
        actor,
      });
      expect(result.status).toBe('failed');
      expect(result.reason).toBe('device_offline');
    });

    it('returns approval_required for reboot without approval', async () => {
      const adapter = createMockDeviceAdapter();
      (adapter as any).getDevice.mockReturnValue({ id: 'device-001', isOnline: true });
      commandDispatcherService.setDeviceAdapter(adapter);

      const result = await commandDispatcherService.dispatchDeviceCommand({
        deviceId: 'device-001',
        commandType: 'reboot',
        actor,
      });
      expect(result.status).toBe('approval_required');
      expect(result.confirmationSessionId).toBe('session-1');
    });

    it('dispatches auto-allowed collect command', async () => {
      commandDispatcherService.setDeviceAdapter(createMockDeviceAdapter());
      const result = await commandDispatcherService.dispatchDeviceCommand({
        deviceId: 'device-001',
        commandType: 'collect',
        actor,
      });
      expect(result.status).toBe('completed');
      expect(result.success).toBe(true);
    });

    it('returns failed when device command fails', async () => {
      commandDispatcherService.setDeviceAdapter(
        createMockDeviceAdapter(true, { success: false, message: 'Device error', reason: 'timeout' })
      );
      const result = await commandDispatcherService.dispatchDeviceCommand({
        deviceId: 'device-001',
        commandType: 'collect',
        actor,
      });
      expect(result.status).toBe('failed');
      expect(result.success).toBe(false);
    });

    it('keeps reboot pending hardware confirmation even when approved is set', async () => {
      const adapter = createMockDeviceAdapter();
      (adapter as any).getDevice.mockReturnValue({ id: 'device-001', isOnline: true });
      commandDispatcherService.setDeviceAdapter(adapter);

      const result = await commandDispatcherService.dispatchDeviceCommand({
        deviceId: 'device-001',
        commandType: 'reboot',
        actor,
        approved: true,
      });
      expect(result.status).toBe('approval_required');
      expect(result.success).toBe(true);
    });

    it('requires hardware confirmation for factory-reset', async () => {
      const adapter = createMockDeviceAdapter();
      (adapter as any).getDevice.mockReturnValue({ id: 'device-001', isOnline: true });
      commandDispatcherService.setDeviceAdapter(adapter);

      const result = await commandDispatcherService.dispatchDeviceCommand({
        deviceId: 'device-001',
        commandType: 'factory-reset',
        actor,
      });
      expect(result.status).toBe('approval_required');
      expect(result.reason).toBe('hardware_confirmation_required');
    });
  });

  describe('handleAgentCommandAck', () => {
    it('updates action run to completed', () => {
      commandDispatcherService.handleAgentCommandAck('agent-001', {
        actionId: 'action-1',
        tenantId: 'tenant-1',
        message: 'Done',
      });
      expect(mockUpdateActionRun).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: 'action-1', status: 'completed' })
      );
    });

    it('ignores when actionId is empty', () => {
      commandDispatcherService.handleAgentCommandAck('agent-001', {});
      expect(mockUpdateActionRun).not.toHaveBeenCalled();
    });
  });

  describe('handleAgentCommandFailure', () => {
    it('updates action run to failed', () => {
      commandDispatcherService.handleAgentCommandFailure('agent-001', {
        actionId: 'action-2',
        tenantId: 'tenant-1',
      });
      expect(mockUpdateActionRun).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: 'action-2', status: 'failed' })
      );
    });

    it('ignores when actionId is empty', () => {
      commandDispatcherService.handleAgentCommandFailure('agent-001', {});
      expect(mockUpdateActionRun).not.toHaveBeenCalled();
    });
  });
});
