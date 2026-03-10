import { randomUUID } from 'crypto';
import auditLogger from '../security/audit-logger.service';
import logger from '../utils/logger';
import { securityOperationsService } from './security-operations.service';

type AgentGatewayLike = {
  getAgent(agentId: string): any;
  sendCommandToAgent(agentId: string, command: { type: string; payload?: any; metadata?: any }, userId?: string): boolean;
};

type DeviceCommandAdapter = {
  getDevice(deviceId: string): any;
  executeCommand(input: {
    deviceId: string;
    command: string;
    params?: Record<string, any>;
    actorId: string;
    actorEmail?: string;
    actorIp?: string;
    actionId?: string;
  }): Promise<{
    success: boolean;
    record?: any;
    message: string;
    reason?: string;
  }> | {
    success: boolean;
    record?: any;
    message: string;
    reason?: string;
  };
};

type CommandActor = {
  tenantId: string;
  userId: string;
  email?: string;
  ip?: string;
};

type DispatchStatus = 'queued' | 'running' | 'completed' | 'failed' | 'approval_required';

const AUTO_AGENT_COMMANDS = new Set(['scan', 'block_ip', 'unblock_ip']);
const AUTO_DEVICE_COMMANDS = new Set(['collect', 'sync-config']);
const APPROVAL_DEVICE_COMMANDS = new Set(['reboot']);

class CommandDispatcherService {
  private agentGateway: AgentGatewayLike | null = null;
  private deviceAdapter: DeviceCommandAdapter | null = null;

  setAgentGateway(gateway: AgentGatewayLike | null): void {
    this.agentGateway = gateway;
  }

  setDeviceAdapter(adapter: DeviceCommandAdapter | null): void {
    this.deviceAdapter = adapter;
  }

  private commandTitle(scope: 'agent' | 'device', commandType: string, targetId: string, payload?: Record<string, any>): string {
    if (scope === 'agent') {
      if (commandType === 'block_ip') {
        return `Agent block rule applied for ${payload?.ip || 'unknown-ip'}`;
      }
      if (commandType === 'unblock_ip') {
        return `Agent block rule removed for ${payload?.ip || 'unknown-ip'}`;
      }
      if (commandType === 'scan') {
        return 'Agent scan command dispatched';
      }
      return `Agent command ${commandType} dispatched to ${targetId}`;
    }

    return `Device command: ${commandType}`;
  }

  private rollbackNotes(scope: 'agent' | 'device', commandType: string): string {
    if (scope === 'agent') {
      if (commandType === 'block_ip') {
        return 'Send an unblock command if legitimate traffic was blocked.';
      }
      if (commandType === 'unblock_ip') {
        return 'Re-apply the block if the address becomes hostile again.';
      }
      return 'Cancel or supersede the generated task if the command targeted the wrong node.';
    }

    if (commandType === 'reboot') {
      return 'Reboot the device again or power-cycle it if the approval path leaves the node unreachable.';
    }
    return 'Re-run the collection or sync job if the command result is incomplete.';
  }

  private async writeAudit(input: {
    tenantId: string;
    actor: CommandActor;
    scope: 'agent' | 'device';
    targetId: string;
    action: string;
    severity: 'info' | 'warning';
    status: 'success' | 'failure';
    details: Record<string, any>;
  }): Promise<void> {
    try {
      await auditLogger.log({
        tenantId: input.tenantId,
        eventType: `${input.scope}_${input.action}`,
        category: 'command',
        severity: input.severity,
        actor: { type: 'user', id: input.actor.userId, email: input.actor.email, ip: input.actor.ip },
        target: { type: input.scope, id: input.targetId },
        action: input.action,
        details: input.details,
        status: input.status
      });
    } catch (error: any) {
      logger.warn('Command audit log unavailable', {
        scope: input.scope,
        action: input.action,
        targetId: input.targetId,
        error: error?.message
      });
    }
  }

  private safeRecordActionRun(input: Parameters<typeof securityOperationsService.recordActionRun>[0]): void {
    try {
      securityOperationsService.recordActionRun(input);
    } catch (error: any) {
      logger.warn('Failed to persist action run', { error: error?.message, actionId: input.actionId, title: input.title });
    }
  }

  private safeUpdateActionRun(input: Parameters<typeof securityOperationsService.updateActionRun>[0]): void {
    try {
      securityOperationsService.updateActionRun(input);
    } catch (error: any) {
      logger.warn('Failed to update action run', { error: error?.message, actionId: input.actionId });
    }
  }

  async dispatchAgentCommand(input: {
    agentId: string;
    commandType: string;
    payload?: Record<string, any>;
    actor: CommandActor;
    approved?: boolean;
  }): Promise<{ success: boolean; status: DispatchStatus; actionId: string; message: string; reason?: string }> {
    const actionId = randomUUID();
    const title = this.commandTitle('agent', input.commandType, input.agentId, input.payload);
    const operator = input.actor.email || input.actor.userId;
    const autoAllowed = AUTO_AGENT_COMMANDS.has(input.commandType);

    if (!autoAllowed && !input.approved) {
      this.safeRecordActionRun({
        actionId,
        tenantId: input.actor.tenantId,
        title,
        status: 'pending',
        operator,
        rollbackNotes: this.rollbackNotes('agent', input.commandType),
        runLog: [
          {
            at: new Date().toISOString(),
            actor: operator,
            message: `Command ${input.commandType} queued for approval.`,
            targetId: input.agentId,
            payload: input.payload || {}
          }
        ]
      });
      await this.writeAudit({
        tenantId: input.actor.tenantId,
        actor: input.actor,
        scope: 'agent',
        targetId: input.agentId,
        action: input.commandType,
        severity: 'warning',
        status: 'success',
        details: { actionId, approvalRequired: true, payload: input.payload || {} }
      });
      return {
        success: true,
        status: 'approval_required',
        actionId,
        message: `Command ${input.commandType} requires approval before execution.`,
        reason: 'approval_required'
      };
    }

    const agent = this.agentGateway?.getAgent(input.agentId);
    if (!this.agentGateway || !agent) {
      await this.writeAudit({
        tenantId: input.actor.tenantId,
        actor: input.actor,
        scope: 'agent',
        targetId: input.agentId,
        action: input.commandType,
        severity: 'warning',
        status: 'failure',
        details: { actionId, reason: 'agent_not_available', payload: input.payload || {} }
      });
      return {
        success: false,
        status: 'failed',
        actionId,
        message: 'Agent gateway unavailable or agent offline.',
        reason: 'agent_not_available'
      };
    }

    this.safeRecordActionRun({
      actionId,
      tenantId: input.actor.tenantId,
      title,
      status: 'queued',
      operator,
      rollbackNotes: this.rollbackNotes('agent', input.commandType),
      runLog: [
        {
          at: new Date().toISOString(),
          actor: operator,
          message: `Queued agent command ${input.commandType}.`,
          targetId: input.agentId,
          payload: input.payload || {}
        }
      ]
    });

    const accepted = this.agentGateway.sendCommandToAgent(
      input.agentId,
      {
        type: input.commandType,
        payload: {
          ...(input.payload || {}),
          actionId
        },
        metadata: {
          actionId,
          tenantId: input.actor.tenantId,
          actorId: input.actor.userId,
          actorEmail: input.actor.email
        }
      },
      input.actor.userId
    );

    if (!accepted) {
      this.safeUpdateActionRun({
        tenantId: input.actor.tenantId,
        actionId,
        status: 'failed',
        appendLog: [
          {
            at: new Date().toISOString(),
            actor: 'agent-gateway',
            message: 'Agent rejected command or was unavailable.',
            targetId: input.agentId
          }
        ]
      });
      await this.writeAudit({
        tenantId: input.actor.tenantId,
        actor: input.actor,
        scope: 'agent',
        targetId: input.agentId,
        action: input.commandType,
        severity: 'warning',
        status: 'failure',
        details: { actionId, reason: 'dispatch_rejected', payload: input.payload || {} }
      });
      return {
        success: false,
        status: 'failed',
        actionId,
        message: 'Agent rejected the command.',
        reason: 'dispatch_rejected'
      };
    }

    this.safeUpdateActionRun({
      tenantId: input.actor.tenantId,
      actionId,
      status: 'running',
      appendLog: [
        {
          at: new Date().toISOString(),
          actor: 'agent-gateway',
          message: 'Agent command accepted by gateway.',
          targetId: input.agentId
        }
      ]
    });
    await this.writeAudit({
      tenantId: input.actor.tenantId,
      actor: input.actor,
      scope: 'agent',
      targetId: input.agentId,
      action: input.commandType,
      severity: input.commandType === 'block_ip' ? 'warning' : 'info',
      status: 'success',
      details: { actionId, payload: input.payload || {} }
    });

    return {
      success: true,
      status: 'running',
      actionId,
      message: `Agent command ${input.commandType} dispatched successfully.`
    };
  }

  async dispatchDeviceCommand(input: {
    deviceId: string;
    commandType: string;
    payload?: Record<string, any>;
    actor: CommandActor;
  approved?: boolean;
  }): Promise<{ success: boolean; status: DispatchStatus; actionId: string; message: string; record?: any; reason?: string }> {
    const actionId = randomUUID();
    const title = this.commandTitle('device', input.commandType, input.deviceId, input.payload);
    const operator = input.actor.email || input.actor.userId;
    const device = this.deviceAdapter?.getDevice(input.deviceId);
    const requiresApproval = APPROVAL_DEVICE_COMMANDS.has(input.commandType) && !input.approved;
    const autoAllowed = AUTO_DEVICE_COMMANDS.has(input.commandType) || input.approved === true;

    if (!this.deviceAdapter || !device) {
      await this.writeAudit({
        tenantId: input.actor.tenantId,
        actor: input.actor,
        scope: 'device',
        targetId: input.deviceId,
        action: input.commandType,
        severity: 'warning',
        status: 'failure',
        details: { actionId, reason: 'device_not_available', payload: input.payload || {} }
      });
      return {
        success: false,
        status: 'failed',
        actionId,
        message: 'Device unavailable or command dispatcher not configured.',
        reason: 'device_not_available'
      };
    }

    if (device?.isOnline === false) {
      await this.writeAudit({
        tenantId: input.actor.tenantId,
        actor: input.actor,
        scope: 'device',
        targetId: input.deviceId,
        action: input.commandType,
        severity: 'warning',
        status: 'failure',
        details: { actionId, reason: 'device_offline', payload: input.payload || {} }
      });
      return {
        success: false,
        status: 'failed',
        actionId,
        message: 'Device is offline.',
        reason: 'device_offline'
      };
    }

    if (requiresApproval) {
      this.safeRecordActionRun({
        actionId,
        tenantId: input.actor.tenantId,
        title,
        status: 'pending',
        operator,
        rollbackNotes: this.rollbackNotes('device', input.commandType),
        runLog: [
          {
            at: new Date().toISOString(),
            actor: operator,
            message: `Command ${input.commandType} requires approval before execution.`,
            targetId: input.deviceId,
            payload: input.payload || {}
          }
        ]
      });
      await this.writeAudit({
        tenantId: input.actor.tenantId,
        actor: input.actor,
        scope: 'device',
        targetId: input.deviceId,
        action: input.commandType,
        severity: 'warning',
        status: 'success',
        details: { actionId, approvalRequired: true, payload: input.payload || {} }
      });
      return {
        success: true,
        status: 'approval_required',
        actionId,
        message: `Device command ${input.commandType} requires approval before execution.`,
        reason: 'approval_required'
      };
    }

    if (!autoAllowed) {
      await this.writeAudit({
        tenantId: input.actor.tenantId,
        actor: input.actor,
        scope: 'device',
        targetId: input.deviceId,
        action: input.commandType,
        severity: 'warning',
        status: 'failure',
        details: { actionId, reason: 'device_not_available', payload: input.payload || {} }
      });
      return {
        success: false,
        status: 'failed',
        actionId,
        message: `Device command ${input.commandType} is not permitted without approval.`,
        reason: 'command_not_permitted'
      };
    }

    this.safeRecordActionRun({
      actionId,
      tenantId: input.actor.tenantId,
      title,
      status: 'running',
      operator,
      rollbackNotes: this.rollbackNotes('device', input.commandType),
      runLog: [
        {
          at: new Date().toISOString(),
          actor: operator,
          message: `Executing device command ${input.commandType}.`,
          targetId: input.deviceId,
          payload: input.payload || {}
        }
      ]
    });

    const result = await this.deviceAdapter.executeCommand({
      deviceId: input.deviceId,
      command: input.commandType,
      params: input.payload || {},
      actorId: input.actor.userId,
      actorEmail: input.actor.email,
      actorIp: input.actor.ip,
      actionId
    });

    this.safeUpdateActionRun({
      tenantId: input.actor.tenantId,
      actionId,
      status: result.success ? 'completed' : 'failed',
      appendLog: [
        {
          at: new Date().toISOString(),
          actor: 'device-gateway',
          message: result.message,
          targetId: input.deviceId,
          result: result.success ? 'completed' : 'failed'
        }
      ]
    });

    await this.writeAudit({
      tenantId: input.actor.tenantId,
      actor: input.actor,
      scope: 'device',
      targetId: input.deviceId,
      action: input.commandType,
      severity: input.commandType === 'reboot' ? 'warning' : 'info',
      status: result.success ? 'success' : 'failure',
      details: { actionId, payload: input.payload || {}, message: result.message, reason: result.reason }
    });

    return {
      success: result.success,
      status: result.success ? 'completed' : 'failed',
      actionId,
      message: result.message,
      record: result.record,
      reason: result.reason
    };
  }

  handleAgentCommandAck(agentId: string, data: Record<string, any>): void {
    const tenantId = String(data?.tenantId || 'global');
    const actionId = String(data?.actionId || '').trim();
    if (!actionId) {
      return;
    }

    this.safeUpdateActionRun({
      tenantId,
      actionId,
      status: 'completed',
      appendLog: [
        {
          at: new Date().toISOString(),
          actor: 'agent',
          message: data?.message || `Agent ${agentId} acknowledged command.`,
          agentId,
          data
        }
      ]
    });
  }

  handleAgentCommandFailure(agentId: string, data: Record<string, any>): void {
    const tenantId = String(data?.tenantId || 'global');
    const actionId = String(data?.actionId || '').trim();
    if (!actionId) {
      return;
    }

    this.safeUpdateActionRun({
      tenantId,
      actionId,
      status: 'failed',
      appendLog: [
        {
          at: new Date().toISOString(),
          actor: 'agent',
          message: data?.message || `Agent ${agentId} reported command failure.`,
          agentId,
          data
        }
      ]
    });
  }
}

export const commandDispatcherService = new CommandDispatcherService();
