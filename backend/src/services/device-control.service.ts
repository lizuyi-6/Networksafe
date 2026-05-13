import { randomUUID } from 'crypto';
import { getDatabase } from '../config/database';
import { artifactStoreService } from './artifact-store.service';
import auditLogger from '../security/audit-logger.service';
import { hashPayload, verifyHardwareGrantSignature } from '../security/hardware-grant';
import logger from '../utils/logger';
import { commandDispatcherService } from './command-dispatcher.service';
import { getDeviceById } from './device-registry.service';

export interface DeviceFirmwareRecord {
  id: string;
  tenantId: string;
  fileName: string;
  version: string;
  channel: string;
  artifactRef: string;
  artifactLocation: string;
  sizeBytes: number;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface DeviceOtaJobRecord {
  id: string;
  tenantId: string;
  deviceId: string;
  firmwareId: string;
  status: string;
  requestedBy: string;
  result: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceConfirmationSessionRecord {
  id: string;
  tenantId: string;
  deviceId: string;
  commandType: string;
  payload: Record<string, any>;
  status: string;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  result?: Record<string, any>;
}

type GatewayEmitter = (deviceId: string, command: string, params?: Record<string, any>) => Promise<boolean> | boolean;

function parseJson<T>(value: any, fallback: T): T {
  if (!value || typeof value !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

class DeviceControlService {
  private schemaReady = false;
  private gatewayEmitter: GatewayEmitter | null = null;

  setGatewayEmitter(emitter: GatewayEmitter | null): void {
    this.gatewayEmitter = emitter;
  }

  prepare(): void {
    if (this.schemaReady) {
      return;
    }

    const db = getDatabase();
    db.exec(`
      CREATE TABLE IF NOT EXISTS device_firmware (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        version TEXT NOT NULL,
        channel TEXT NOT NULL,
        artifact_ref TEXT NOT NULL,
        artifact_location TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_device_firmware_channel ON device_firmware(tenant_id, channel, created_at DESC);

      CREATE TABLE IF NOT EXISTS device_ota_jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        firmware_id TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_device_ota_jobs_device ON device_ota_jobs(device_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS device_confirmation_sessions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        command_type TEXT NOT NULL,
        payload_json TEXT,
        status TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        confirmed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_device_confirmation_device ON device_confirmation_sessions(device_id, created_at DESC);
    `);

    this.schemaReady = true;
  }

  private assertPrepared(): void {
    if (this.schemaReady) {
      return;
    }

    if (process.env.NODE_ENV === 'test') {
      this.prepare();
      return;
    }

    throw new Error('Device control schema not initialized. Call deviceControlService.prepare() during bootstrap.');
  }

  async uploadFirmware(input: {
    tenantId: string;
    fileName: string;
    version: string;
    channel: string;
    contentBase64: string;
    notes?: string;
    actorId: string;
    actorEmail?: string;
    actorIp?: string;
  }): Promise<DeviceFirmwareRecord> {
    this.assertPrepared();
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const buffer = Buffer.from(input.contentBase64, 'base64');
    const artifact = await artifactStoreService.writeBinary(
      'devices/firmware',
      `${input.channel}/${input.version}-${input.fileName}`,
      buffer,
      'application/octet-stream'
    );

    const row = {
      id,
      tenant_id: input.tenantId,
      file_name: input.fileName,
      version: input.version,
      channel: input.channel,
      artifact_ref: artifact.artifactRef,
      artifact_location: artifact.location,
      size_bytes: buffer.length,
      notes: input.notes || null,
      created_by: input.actorEmail || input.actorId,
      created_at: createdAt
    };

    getDatabase().prepare(`
      INSERT INTO device_firmware (
        id, tenant_id, file_name, version, channel, artifact_ref, artifact_location, size_bytes, notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.tenant_id,
      row.file_name,
      row.version,
      row.channel,
      row.artifact_ref,
      row.artifact_location,
      row.size_bytes,
      row.notes,
      row.created_by,
      row.created_at
    );

    await auditLogger.log({
      tenantId: input.tenantId,
      eventType: 'device_firmware_uploaded',
      category: 'system',
      severity: 'info',
      actor: { type: 'user', id: input.actorId, email: input.actorEmail, ip: input.actorIp },
      action: 'upload_device_firmware',
      target: { type: 'server', id },
      details: {
        fileName: input.fileName,
        version: input.version,
        channel: input.channel,
        sizeBytes: buffer.length,
        artifactRef: artifact.artifactRef
      },
      status: 'success'
    });

    return this.mapFirmwareRow(row);
  }

  async triggerOta(input: {
    tenantId: string;
    deviceId: string;
    firmwareId: string;
    actorId: string;
    actorEmail?: string;
    actorIp?: string;
  }): Promise<DeviceOtaJobRecord> {
    this.assertPrepared();
    const firmware = this.getFirmware(input.firmwareId);
    if (!firmware) {
      throw new Error('backend.firmware_not_found');
    }
    if (!this.gatewayEmitter) {
      throw new Error('backend.device_gateway_unavailable');
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const payload = {
      otaJobId: id,
      firmwareId: firmware.id,
      version: firmware.version,
      channel: firmware.channel,
      artifactRef: firmware.artifactRef,
      artifactLocation: firmware.artifactLocation,
      fileName: firmware.fileName
    };

    const accepted = await this.gatewayEmitter(input.deviceId, 'ota_update', payload);
    const row = {
      id,
      tenant_id: input.tenantId,
      device_id: input.deviceId,
      firmware_id: input.firmwareId,
      status: accepted ? 'queued' : 'failed',
      requested_by: input.actorEmail || input.actorId,
      result_json: JSON.stringify({
        accepted,
        payload,
        message: accepted ? 'OTA command dispatched.' : 'Device gateway rejected OTA command.'
      }),
      created_at: createdAt,
      updated_at: createdAt
    };

    getDatabase().prepare(`
      INSERT INTO device_ota_jobs (
        id, tenant_id, device_id, firmware_id, status, requested_by, result_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.tenant_id,
      row.device_id,
      row.firmware_id,
      row.status,
      row.requested_by,
      row.result_json,
      row.created_at,
      row.updated_at
    );

    await auditLogger.log({
      tenantId: input.tenantId,
      eventType: 'device_ota_dispatched',
      category: 'command',
      severity: accepted ? 'warning' : 'critical',
      actor: { type: 'user', id: input.actorId, email: input.actorEmail, ip: input.actorIp },
      action: 'dispatch_device_ota',
      target: { type: 'server', id: input.deviceId },
      details: {
        otaJobId: id,
        firmwareId: firmware.id,
        version: firmware.version,
        accepted
      },
      status: accepted ? 'success' : 'failure'
    });

    return this.mapOtaRow(row);
  }

  async createPhysicalConfirmation(input: {
    tenantId: string;
    deviceId: string;
    commandType: string;
    payload?: Record<string, any>;
    actorId: string;
    actorEmail?: string;
    actorIp?: string;
  }): Promise<DeviceConfirmationSessionRecord> {
    this.assertPrepared();
    if (!this.gatewayEmitter) {
      throw new Error('backend.device_gateway_unavailable');
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const payload = input.payload || {};
    const accepted = await this.gatewayEmitter(input.deviceId, 'physical_confirmation_required', {
      confirmationSessionId: id,
      commandType: input.commandType,
      payload,
      prompt: `Press GPIO15 to confirm ${input.commandType}`
    });

    const row = {
      id,
      tenant_id: input.tenantId,
      device_id: input.deviceId,
      command_type: input.commandType,
      payload_json: JSON.stringify(payload),
      status: accepted ? 'pending_physical_confirmation' : 'failed',
      requested_by: input.actorEmail || input.actorId,
      result_json: JSON.stringify({
        accepted
      }),
      created_at: createdAt,
      updated_at: createdAt,
      confirmed_at: null
    };

    getDatabase().prepare(`
      INSERT INTO device_confirmation_sessions (
        id, tenant_id, device_id, command_type, payload_json, status, requested_by, result_json, created_at, updated_at, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.tenant_id,
      row.device_id,
      row.command_type,
      row.payload_json,
      row.status,
      row.requested_by,
      row.result_json,
      row.created_at,
      row.updated_at,
      row.confirmed_at
    );

    return this.mapConfirmationRow(row);
  }

  async handleOtaStatus(deviceId: string, payload: Record<string, any>): Promise<void> {
    this.assertPrepared();
    const otaJobId = String(payload?.otaJobId || '').trim();
    if (!otaJobId) {
      return;
    }

    const existing = getDatabase().prepare(`
      SELECT *
      FROM device_ota_jobs
      WHERE id = ? AND device_id = ?
      LIMIT 1
    `).get(otaJobId, deviceId) as any;

    if (!existing) {
      return;
    }

    const nextStatus = String(payload?.status || 'unknown');
    const updatedAt = new Date().toISOString();
    const nextResult = {
      ...parseJson(existing.result_json, {}),
      lastUpdate: payload
    };

    getDatabase().prepare(`
      UPDATE device_ota_jobs
      SET status = ?, result_json = ?, updated_at = ?
      WHERE id = ? AND device_id = ?
    `).run(nextStatus, JSON.stringify(nextResult), updatedAt, otaJobId, deviceId);
  }

  async handlePhysicalConfirmationAck(deviceId: string, payload: Record<string, any>): Promise<void> {
    this.assertPrepared();
    const confirmationSessionId = String(payload?.confirmationSessionId || '').trim();
    if (!confirmationSessionId) {
      return;
    }

    const existing = getDatabase().prepare(`
      SELECT *
      FROM device_confirmation_sessions
      WHERE id = ? AND device_id = ?
      LIMIT 1
    `).get(confirmationSessionId, deviceId) as any;

    if (!existing) {
      return;
    }

    const device = getDeviceById(deviceId) as any;
    const publicKeyPem = device?.physicalAuth?.publicKeyPem;
    let verified = false;
    if (publicKeyPem && payload.signature) {
      verified = verifyHardwareGrantSignature(publicKeyPem, {
        gateId: String(payload?.gateId || deviceId),
        sessionId: confirmationSessionId,
        actionId: String(payload?.actionId || confirmationSessionId),
        tenantId: String(existing.tenant_id || 'global'),
        scope: 'device',
        targetId: deviceId,
        commandType: existing.command_type,
        payloadHash: hashPayload(parseJson(existing.payload_json, {})),
        policyDigest: String(payload?.policyDigest || ''),
        challenge: String(payload?.challenge || ''),
        breakerTarget: String(payload?.breakerTarget || ''),
        interlockAction: String(payload?.interlockAction || ''),
        issuedAt: String(payload?.issuedAt || existing.created_at || ''),
        expiresAt: String(payload?.expiresAt || existing.updated_at || ''),
        monotonicCounter: Number(payload?.monotonicCounter || 0),
        signature: String(payload.signature),
        algorithm: 'ECDSA_P256_SHA256'
      });
    }

    const confirmed = Boolean(payload?.confirmed) && Boolean(payload.signature) && verified;
    const confirmedAt = confirmed ? new Date().toISOString() : null;
    const dispatchResult = confirmed
      ? await commandDispatcherService.dispatchConfirmedDeviceCommand({
          deviceId,
          commandType: existing.command_type,
          payload: parseJson(existing.payload_json, {}),
          actor: {
            tenantId: existing.tenant_id,
            userId: 'physical-confirmation-gateway',
            email: existing.requested_by,
            ip: 'device-gateway'
          },
          actionId: confirmationSessionId
        })
      : null;

    const result: Record<string, any> = {
      ack: payload,
      dispatchResult
    };
    if (payload.signature) {
      result.verified = verified;
    }

    getDatabase().prepare(`
      UPDATE device_confirmation_sessions
      SET status = ?, result_json = ?, updated_at = ?, confirmed_at = ?
      WHERE id = ? AND device_id = ?
    `).run(
      confirmed ? 'confirmed' : 'rejected',
      JSON.stringify(result),
      new Date().toISOString(),
      confirmedAt,
      confirmationSessionId,
      deviceId
    );
  }

  getFirmware(id: string): DeviceFirmwareRecord | null {
    this.assertPrepared();
    const row = getDatabase().prepare(`
      SELECT *
      FROM device_firmware
      WHERE id = ?
      LIMIT 1
    `).get(id) as any;
    return row ? this.mapFirmwareRow(row) : null;
  }

  private mapFirmwareRow(row: any): DeviceFirmwareRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      fileName: row.file_name,
      version: row.version,
      channel: row.channel,
      artifactRef: row.artifact_ref,
      artifactLocation: row.artifact_location,
      sizeBytes: Number(row.size_bytes || 0),
      notes: row.notes || undefined,
      createdBy: row.created_by,
      createdAt: row.created_at
    };
  }

  private mapOtaRow(row: any): DeviceOtaJobRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      deviceId: row.device_id,
      firmwareId: row.firmware_id,
      status: row.status,
      requestedBy: row.requested_by,
      result: parseJson(row.result_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapConfirmationRow(row: any): DeviceConfirmationSessionRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      deviceId: row.device_id,
      commandType: row.command_type,
      payload: parseJson(row.payload_json, {}),
      status: row.status,
      requestedBy: row.requested_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      confirmedAt: row.confirmed_at || undefined,
      result: parseJson(row.result_json, {})
    };
  }
}

export const deviceControlService = new DeviceControlService();
