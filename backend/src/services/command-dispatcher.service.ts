import { randomUUID } from 'crypto';
import auditLogger from '../security/audit-logger.service';
import { classifyCommandRisk } from '../security/command-risk-policy';
import type { HardwareGrantRecord, CommandIntentRecord } from './hardware-authorization.service';
import { hardwareAuthorizationService } from './hardware-authorization.service';
import { deploymentRunService } from './deployment-run.service';
import logger from '../utils/logger';
import { detectionPipelineService } from './detection-pipeline.service';
import { securityOperationsService } from './security-operations.service';
import { cloneDefaultConfig, platformConfigService } from './platform-config.service';
import type { DetectionRequest } from './detection-engine';

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
    hardwareGrant?: HardwareGrantRecord;
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
  // SECURITY FIX R2-deep / V12.6: typed discriminator. A user-facing
  // command must have kind='user' (or undefined for backwards compat,
  // but always a non-empty userId). Internal trusted actors
  // (hardware-gateway, agent-ack, system) MUST declare their kind so
  // the cross-tenant gate can be bypassed by design rather than by
  // an empty-userId heuristic.
  kind?: 'user' | 'hardware-gateway' | 'agent-ack' | 'system' | 'test-runtime';
};

type DispatchStatus = 'queued' | 'running' | 'completed' | 'failed' | 'approval_required';

interface DispatchResult {
  success: boolean;
  status: DispatchStatus;
  actionId: string;
  message: string;
  record?: any;
  reason?: string;
  confirmationSessionId?: string;
  hardwareGateId?: string;
}

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

  private buildCommandReviewRequest(input: {
    scope: 'agent' | 'device';
    targetId: string;
    commandType: string;
    payload?: Record<string, any>;
    actor: CommandActor;
    actionId: string;
    classificationLevel: string;
  }): DetectionRequest {
    const timestamp = new Date().toISOString();
    return {
      tenantId: input.actor.tenantId,
      channel: 'agent',
      requestId: input.actionId,
      timestamp,
      sourceIp: input.actor.ip,
      method: 'COMMAND',
      path: `/${input.scope}/${input.targetId}/${input.commandType}`,
      headers: {
        'x-aetherguard-command-type': input.commandType,
        'x-aetherguard-command-scope': input.scope,
        'x-aetherguard-classification-level': input.classificationLevel
      },
      body: JSON.stringify({
        scope: input.scope,
        targetId: input.targetId,
        commandType: input.commandType,
        payload: input.payload || {},
        actionId: input.actionId
      }),
      normalizedBody: JSON.stringify({
        scope: input.scope,
        targetId: input.targetId,
        commandType: input.commandType,
        payload: input.payload || {},
        actionId: input.actionId
      }),
      parsedBody: JSON.stringify({
        scope: input.scope,
        targetId: input.targetId,
        commandType: input.commandType,
        payload: input.payload || {},
        actionId: input.actionId
      }),
      evidence: JSON.stringify({
        scope: input.scope,
        targetId: input.targetId,
        commandType: input.commandType,
        payload: input.payload || {},
        actor: input.actor.email || input.actor.userId,
        classificationLevel: input.classificationLevel
      }),
      rawPayload: JSON.stringify(input.payload || {}),
      metadata: {
        scope: input.scope,
        targetId: input.targetId,
        commandType: input.commandType,
        actionId: input.actionId,
        actorId: input.actor.userId,
        actorEmail: input.actor.email,
        classificationLevel: input.classificationLevel
      }
    };
  }

  private async resolveDetectionPipelineSettings(tenantId: string) {
    try {
      const config = await platformConfigService.getConfig(tenantId);
      return config.detectionPipeline;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Database not initialized')) {
        return cloneDefaultConfig().detectionPipeline;
      }
      throw error;
    }
  }

  private async reviewCommandForClassification(input: {
    scope: 'agent' | 'device';
    targetId: string;
    commandType: string;
    payload?: Record<string, any>;
    actor: CommandActor;
    actionId: string;
    approved?: boolean;
  }): Promise<{
    required: boolean;
    allowed: boolean;
    status: 'not_required' | 'completed' | 'failed' | 'timeout' | 'unavailable';
    reason?: string;
    message?: string;
    review?: any;
  }> {
    const settings = await this.resolveDetectionPipelineSettings(input.actor.tenantId);
    const classificationLevel = settings.classificationLevel || 'standard';
    const riskClass = classifyCommandRisk(input.commandType);
    const reviewRequired = classificationLevel === 'maximum'
      || (classificationLevel === 'elevated' && (riskClass === 'admin_approval_required' || riskClass === 'physical_confirmation_required'));

    if (!reviewRequired) {
      return { required: false, allowed: true, status: 'not_required' };
    }

    const request = this.buildCommandReviewRequest({
      scope: input.scope,
      targetId: input.targetId,
      commandType: input.commandType,
      payload: input.payload,
      actor: input.actor,
      actionId: input.actionId,
      classificationLevel
    });

    const review = await detectionPipelineService.runBlockingReview({
      request,
      settings,
      attackFamily: 'automation',
      classificationLevel,
      decisionSource: `command:${input.scope}:${input.commandType}`,
      ruleMatched: false,
      baseRiskScore: riskClass === 'physical_confirmation_required' ? 1 : riskClass === 'admin_approval_required' ? 0.85 : 0.5,
      reason: `classification:${classificationLevel}`,
      forceDebate: true,
      routeModeOverride: 'local_only'
    });

    if (!review.allowed || review.status !== 'completed' || !review.aiResult) {
      return {
        required: true,
        allowed: false,
        status: review.status,
        reason: review.reason || 'blocking_review_failed',
        message: review.status === 'timeout'
          ? 'Command blocked while waiting for multi-agent discussion.'
          : 'Command rejected by multi-agent discussion.',
        review
      };
    }

    if (classificationLevel === 'maximum') {
      return {
        required: true,
        allowed: true,
        status: 'completed',
        review
      };
    }

    if (riskClass === 'physical_confirmation_required') {
      return {
        required: true,
        allowed: true,
        status: 'completed',
        review
      };
    }

    if (riskClass === 'admin_approval_required' && input.approved === false) {
      return {
        required: true,
        allowed: false,
        status: 'completed',
        reason: 'approval_required',
        message: 'Command requires approval before execution.',
        review
      };
    }

    return {
      required: true,
      allowed: true,
      status: 'completed',
      review
    };
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

  private async requestHardwareConfirmation(input: {
    scope: 'agent' | 'device';
    targetId: string;
    commandType: string;
    payload?: Record<string, any>;
    actor: CommandActor;
    actionId: string;
  }): Promise<DispatchResult> {
    const title = this.commandTitle(input.scope, input.commandType, input.targetId, input.payload);
    const operator = input.actor.email || input.actor.userId;
    this.safeRecordActionRun({
      actionId: input.actionId,
      tenantId: input.actor.tenantId,
      title,
      status: 'pending',
      operator,
      rollbackNotes: this.rollbackNotes(input.scope, input.commandType),
      runLog: [
        {
          at: new Date().toISOString(),
          actor: operator,
          message: `Waiting for hardware confirmation before ${input.commandType}.`,
          targetId: input.targetId,
          payload: input.payload || {}
        }
      ]
    });

    const request = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: input.actor.tenantId,
      scope: input.scope,
      targetId: input.targetId,
      commandType: input.commandType,
      payload: input.payload || {},
      actorId: input.actor.userId,
      actorEmail: input.actor.email,
      actorIp: input.actor.ip,
      actionId: input.actionId
    });

    if (!request.success) {
      this.safeUpdateActionRun({
        tenantId: input.actor.tenantId,
        actionId: input.actionId,
        status: 'failed',
        appendLog: [
          {
            at: new Date().toISOString(),
            actor: 'hardware-authorization',
            message: request.message,
            result: request.reason || 'failed'
          }
        ]
      });
      await this.writeAudit({
        tenantId: input.actor.tenantId,
        actor: input.actor,
        scope: input.scope,
        targetId: input.targetId,
        action: input.commandType,
        severity: 'warning',
        status: 'failure',
        details: { actionId: input.actionId, reason: request.reason, payload: input.payload || {} }
      });
      return {
        success: false,
        status: 'failed',
        actionId: input.actionId,
        message: request.message,
        reason: request.reason,
        confirmationSessionId: request.session?.sessionId,
        hardwareGateId: request.session?.gateId
      };
    }

    await this.writeAudit({
      tenantId: input.actor.tenantId,
      actor: input.actor,
      scope: input.scope,
      targetId: input.targetId,
      action: input.commandType,
      severity: 'warning',
      status: 'success',
      details: {
        actionId: input.actionId,
        confirmationSessionId: request.session?.sessionId,
        gateId: request.session?.gateId,
        payload: input.payload || {}
      }
    });

    return {
      success: true,
      status: 'approval_required',
      actionId: input.actionId,
      message: request.message,
      reason: 'hardware_confirmation_required',
      confirmationSessionId: request.session?.sessionId,
      hardwareGateId: request.session?.gateId
    };
  }

  async dispatchAgentCommand(input: {
    agentId: string;
    commandType: string;
    payload?: Record<string, any>;
    actor: CommandActor;
    approved?: boolean;
  }): Promise<DispatchResult> {
    const actionId = randomUUID();

    // SECURITY FIX R2-deep / V12.6: typed discriminator + non-empty
    // userId guard, identical to the device-command path. A user-facing
    // command with an empty / missing userId is rejected BEFORE the
    // cross-tenant check, closing the historical isInternalActor bypass.
    const isInternalActor = !!(input.actor.kind && input.actor.kind !== 'user');
    if (!isInternalActor) {
      if (typeof input.actor.userId !== 'string' || input.actor.userId.length === 0) {
        return {
          success: false,
          status: 'failed',
          actionId,
          message: 'Actor userId is required for user-initiated commands.',
          reason: 'actor_userid_required'
        };
      }
    }

    // SECURITY FIX R2-deep / V12.6: cross-tenant gate for the AGENT
    // path (mirrors dispatchDeviceCommand). The actor's tenantId MUST
    // match the target agent's tenantId. Internal actors are exempt.
    if (!isInternalActor) {
      const agent = this.agentGateway?.getAgent(input.agentId);
      const agentTenantId = agent?.tenantId;
      if (agentTenantId && input.actor.tenantId && agentTenantId !== input.actor.tenantId) {
        return {
          success: false,
          status: 'failed',
          actionId,
          message: 'Cross-tenant command dispatch is not allowed.',
          reason: 'tenant_mismatch'
        };
      }
    }

    const riskClass = classifyCommandRisk(input.commandType);
    const review = await this.reviewCommandForClassification({
      scope: 'agent',
      targetId: input.agentId,
      commandType: input.commandType,
      payload: input.payload,
      actor: input.actor,
      actionId,
      approved: input.approved
    });
    if (review.required && !review.allowed) {
      if (review.reason === 'approval_required') {
        const operator = input.actor.email || input.actor.userId;
        this.safeRecordActionRun({
          actionId,
          tenantId: input.actor.tenantId,
          title: this.commandTitle('agent', input.commandType, input.agentId, input.payload),
          status: 'pending',
          operator,
          rollbackNotes: this.rollbackNotes('agent', input.commandType),
          runLog: [
            {
              at: new Date().toISOString(),
              actor: operator,
              message: review.message || `Command ${input.commandType} queued for approval.`,
              targetId: input.agentId,
              payload: input.payload || {},
              multiAgentReview: review.review?.status || 'completed'
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
          details: { actionId, approvalRequired: true, payload: input.payload || {}, blockingReview: review.review?.status || 'completed' }
        });
        return {
          success: true,
          status: 'approval_required',
          actionId,
          message: review.message || `Command ${input.commandType} requires approval before execution.`,
          reason: review.reason
        };
      }
      return {
        success: false,
        status: 'failed',
        actionId,
        message: review.message || 'Command rejected by blocking discussion.',
        reason: review.reason || 'blocking_review_failed'
      };
    }
    if (riskClass === 'physical_confirmation_required') {
      return this.requestHardwareConfirmation({
        scope: 'agent',
        targetId: input.agentId,
        commandType: input.commandType,
        payload: input.payload,
        actor: input.actor,
        actionId
      });
    }

    if (riskClass === 'admin_approval_required' && !input.approved) {
      const operator = input.actor.email || input.actor.userId;
      this.safeRecordActionRun({
        actionId,
        tenantId: input.actor.tenantId,
        title: this.commandTitle('agent', input.commandType, input.agentId, input.payload),
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

    return this.executeAgentCommand({
      actionId,
      agentId: input.agentId,
      commandType: input.commandType,
      payload: input.payload,
      actor: input.actor
    });
  }

  async dispatchDeviceCommand(input: {
    deviceId: string;
    commandType: string;
    payload?: Record<string, any>;
    actor: CommandActor;
    approved?: boolean;
  }): Promise<DispatchResult> {
    const actionId = randomUUID();

    // SECURITY FIX R2-deep / V12.6: typed discriminator + non-empty
    // userId guard. A user-facing command with an empty / missing
    // userId is rejected BEFORE the cross-tenant check, so the
    // historical isInternalActor = !userId bypass is closed.
    const isInternalActor = !!(input.actor.kind && input.actor.kind !== 'user');
    if (!isInternalActor) {
      if (typeof input.actor.userId !== 'string' || input.actor.userId.length === 0) {
        return {
          success: false,
          status: 'failed',
          actionId,
          message: 'Actor userId is required for user-initiated commands.',
          reason: 'actor_userid_required'
        };
      }
    }

    // SECURITY FIX R2-deep: cross-tenant gate. The actor's tenantId
    // MUST match the target device's tenantId. Internal actors
    // (hardware-gateway, agent-ack, system, test-runtime) are exempt
    // because they are not user-controlled and operate within a
    // single trusted boundary.
    if (!isInternalActor) {
      const deviceForTenant = this.deviceAdapter?.getDevice(input.deviceId);
      const deviceTenantId = deviceForTenant?.tenantId;
      if (deviceTenantId && input.actor.tenantId && deviceTenantId !== input.actor.tenantId) {
        return {
          success: false,
          status: 'failed',
          actionId,
          message: 'Cross-tenant command dispatch is not allowed.',
          reason: 'tenant_mismatch'
        };
      }
    }

    const device = this.deviceAdapter?.getDevice(input.deviceId);
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

    const riskClass = classifyCommandRisk(input.commandType);
    const review = await this.reviewCommandForClassification({
      scope: 'device',
      targetId: input.deviceId,
      commandType: input.commandType,
      payload: input.payload,
      actor: input.actor,
      actionId,
      approved: input.approved
    });
    if (review.required && !review.allowed) {
      if (review.reason === 'approval_required') {
        const operator = input.actor.email || input.actor.userId;
        this.safeRecordActionRun({
          actionId,
          tenantId: input.actor.tenantId,
          title: this.commandTitle('device', input.commandType, input.deviceId, input.payload),
          status: 'pending',
          operator,
          rollbackNotes: this.rollbackNotes('device', input.commandType),
          runLog: [
            {
              at: new Date().toISOString(),
              actor: operator,
              message: review.message || `Command ${input.commandType} requires approval before execution.`,
              targetId: input.deviceId,
              payload: input.payload || {},
              multiAgentReview: review.review?.status || 'completed'
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
          details: { actionId, approvalRequired: true, payload: input.payload || {}, blockingReview: review.review?.status || 'completed' }
        });
        return {
          success: true,
          status: 'approval_required',
          actionId,
          message: review.message || `Device command ${input.commandType} requires approval before execution.`,
          reason: review.reason
        };
      }
      return {
        success: false,
        status: 'failed',
        actionId,
        message: review.message || 'Command rejected by blocking discussion.',
        reason: review.reason || 'blocking_review_failed'
      };
    }
    if (riskClass === 'physical_confirmation_required') {
      return this.requestHardwareConfirmation({
        scope: 'device',
        targetId: input.deviceId,
        commandType: input.commandType,
        payload: input.payload,
        actor: input.actor,
        actionId
      });
    }

    if (riskClass === 'admin_approval_required' && !input.approved) {
      const operator = input.actor.email || input.actor.userId;
      this.safeRecordActionRun({
        actionId,
        tenantId: input.actor.tenantId,
        title: this.commandTitle('device', input.commandType, input.deviceId, input.payload),
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

    return this.executeDeviceCommand({
      actionId,
      deviceId: input.deviceId,
      commandType: input.commandType,
      payload: input.payload,
      actor: input.actor
    });
  }

  async dispatchConfirmedDeviceCommand(input: {
    deviceId: string;
    commandType: string;
    payload?: Record<string, any>;
    actor: CommandActor;
    actionId: string;
    hardwareGrant?: HardwareGrantRecord;
  }): Promise<DispatchResult> {
    return this.executeDeviceCommand({
      actionId: input.actionId,
      deviceId: input.deviceId,
      commandType: input.commandType,
      payload: input.payload,
      actor: input.actor,
      hardwareGrant: input.hardwareGrant
    });
  }

  async dispatchHardwareConfirmedIntent(intent: CommandIntentRecord, grant: HardwareGrantRecord): Promise<DispatchResult> {
    if (intent.scope === 'deployment') {
      const run = deploymentRunService.confirmApprovedRun(intent, grant);
      const result: DispatchResult = {
        success: Boolean(run),
        status: run ? 'completed' : 'failed',
        actionId: intent.actionId,
        message: run
          ? 'Deployment run approved and waiting for helper execution.'
          : 'Deployment run approval target not found.',
        reason: run ? undefined : 'deployment_run_not_found'
      };
      hardwareAuthorizationService.completeIntent(intent.actionId, result.success, {
        status: result.success ? 'approved' : 'failed',
        message: result.message,
        reason: result.reason || null,
        runId: intent.targetId,
        hardwareGrantId: grant.grantId
      });
      return result;
    }

    const actor: CommandActor = {
      tenantId: intent.tenantId,
      userId: 'hardware-confirmation-gateway',
      email: intent.requestedBy,
      ip: `gate:${grant.gateId}`
    };

    const result = intent.scope === 'agent'
      ? await this.executeAgentCommand({
          actionId: intent.actionId,
          agentId: intent.targetId,
          commandType: intent.commandType,
          payload: intent.payload,
          actor,
          hardwareGrant: grant
        })
      : await this.executeDeviceCommand({
          actionId: intent.actionId,
          deviceId: intent.targetId,
          commandType: intent.commandType,
          payload: intent.payload,
          actor,
          hardwareGrant: grant
        });

    hardwareAuthorizationService.completeIntent(intent.actionId, result.success, {
      status: result.status,
      message: result.message,
      reason: result.reason || null
    });
    return result;
  }

  private async executeAgentCommand(input: {
    actionId: string;
    agentId: string;
    commandType: string;
    payload?: Record<string, any>;
    actor: CommandActor;
    hardwareGrant?: HardwareGrantRecord;
  }): Promise<DispatchResult> {
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
        details: { actionId: input.actionId, reason: 'agent_not_available', payload: input.payload || {} }
      });
      return {
        success: false,
        status: 'failed',
        actionId: input.actionId,
        message: 'Agent gateway unavailable or agent offline.',
        reason: 'agent_not_available'
      };
    }

    const operator = input.actor.email || input.actor.userId;
    this.safeRecordActionRun({
      actionId: input.actionId,
      tenantId: input.actor.tenantId,
      title: this.commandTitle('agent', input.commandType, input.agentId, input.payload),
      status: 'queued',
      operator,
      rollbackNotes: this.rollbackNotes('agent', input.commandType),
      runLog: [
        {
          at: new Date().toISOString(),
          actor: operator,
          message: `Queued agent command ${input.commandType}.`,
          targetId: input.agentId,
          payload: input.payload || {},
          hardwareGrantId: input.hardwareGrant?.grantId || null
        }
      ]
    });

    const accepted = this.agentGateway.sendCommandToAgent(
      input.agentId,
      {
        type: input.commandType,
        payload: {
          ...(input.payload || {}),
          actionId: input.actionId
        },
        metadata: {
          actionId: input.actionId,
          tenantId: input.actor.tenantId,
          actorId: input.actor.userId,
          actorEmail: input.actor.email,
          hardwareGrant: input.hardwareGrant?.grant || null,
          hardwareGrantId: input.hardwareGrant?.grantId || null
        }
      },
      input.actor.userId
    );

    if (!accepted) {
      this.safeUpdateActionRun({
        tenantId: input.actor.tenantId,
        actionId: input.actionId,
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
        details: { actionId: input.actionId, reason: 'dispatch_rejected', payload: input.payload || {} }
      });
      return {
        success: false,
        status: 'failed',
        actionId: input.actionId,
        message: 'Agent rejected the command.',
        reason: 'dispatch_rejected'
      };
    }

    this.safeUpdateActionRun({
      tenantId: input.actor.tenantId,
      actionId: input.actionId,
      status: 'running',
      appendLog: [
        {
          at: new Date().toISOString(),
          actor: 'agent-gateway',
          message: 'Agent command accepted by gateway.',
          targetId: input.agentId,
          hardwareGrantId: input.hardwareGrant?.grantId || null
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
      details: { actionId: input.actionId, payload: input.payload || {}, hardwareGrantId: input.hardwareGrant?.grantId || null }
    });

    return {
      success: true,
      status: 'running',
      actionId: input.actionId,
      message: `Agent command ${input.commandType} dispatched successfully.`
    };
  }

  private async executeDeviceCommand(input: {
    actionId: string;
    deviceId: string;
    commandType: string;
    payload?: Record<string, any>;
    actor: CommandActor;
    hardwareGrant?: HardwareGrantRecord;
  }): Promise<DispatchResult> {
    if (!this.deviceAdapter) {
      return {
        success: false,
        status: 'failed',
        actionId: input.actionId,
        message: 'Device command dispatcher is unavailable.',
        reason: 'device_not_available'
      };
    }

    const operator = input.actor.email || input.actor.userId;
    this.safeRecordActionRun({
      actionId: input.actionId,
      tenantId: input.actor.tenantId,
      title: this.commandTitle('device', input.commandType, input.deviceId, input.payload),
      status: 'running',
      operator,
      rollbackNotes: this.rollbackNotes('device', input.commandType),
      runLog: [
        {
          at: new Date().toISOString(),
          actor: operator,
          message: `Executing device command ${input.commandType}.`,
          targetId: input.deviceId,
          payload: input.payload || {},
          hardwareGrantId: input.hardwareGrant?.grantId || null
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
      actionId: input.actionId,
      hardwareGrant: input.hardwareGrant
    });

    this.safeUpdateActionRun({
      tenantId: input.actor.tenantId,
      actionId: input.actionId,
      status: result.success ? 'completed' : 'failed',
      appendLog: [
        {
          at: new Date().toISOString(),
          actor: 'device-gateway',
          message: result.message,
          targetId: input.deviceId,
          result: result.success ? 'completed' : 'failed',
          hardwareGrantId: input.hardwareGrant?.grantId || null
        }
      ]
    });

    await this.writeAudit({
      tenantId: input.actor.tenantId,
      actor: input.actor,
      scope: 'device',
      targetId: input.deviceId,
      action: input.commandType,
      severity: classifyCommandRisk(input.commandType) === 'physical_confirmation_required' ? 'warning' : 'info',
      status: result.success ? 'success' : 'failure',
      details: {
        actionId: input.actionId,
        payload: input.payload || {},
        message: result.message,
        reason: result.reason,
        hardwareGrantId: input.hardwareGrant?.grantId || null
      }
    });

    return {
      success: result.success,
      status: result.success ? 'completed' : 'failed',
      actionId: input.actionId,
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
      ],
      // SECURITY FIX redteam R3: only accept this ack if the action is still
      // in 'running' state. If two acks arrive simultaneously, the second one
      // sees 'completed' (set by the first) and is silently dropped.
      allowedPriorStatus: ['running']
    });
  }

  /**
   * SECURITY FIX (redteam R3-parallel-ack · V12.8):
   * handleAgentCommandFailure is updated with the same replay guard as
   * handleAgentCommandAck to prevent concurrent failure reports for the same
   * actionId from both being recorded.
   */
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
      ],
      // SECURITY FIX redteam R3: same replay guard as handleAgentCommandAck.
      allowedPriorStatus: ['running']
    });
  }
}

export const commandDispatcherService = new CommandDispatcherService();
