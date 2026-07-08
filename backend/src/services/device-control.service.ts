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
  expiresAt?: string;
  confirmedAt?: string;
  result?: Record<string, any>;
  hardwareContext?: {
    policyDigest: string;
    challenge: string;
    breakerTarget: string;
    interlockAction: string;
  };
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
        -- V2.4 hardened-session columns (nullable for backward compat).
        summary_json TEXT,
        expires_at TEXT,
        last_monotonic_counter INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        confirmed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_device_confirmation_device ON device_confirmation_sessions(device_id, created_at DESC);
    `);

    // V2.4 soft-migration: add hardened-session columns to existing tables
    // (CREATE TABLE IF NOT EXISTS will not ALTER a pre-existing table).
    for (const col of ['summary_json TEXT', 'expires_at TEXT', 'last_monotonic_counter INTEGER']) {
      try {
        getDatabase().exec('ALTER TABLE device_confirmation_sessions ADD COLUMN ' + col);
      } catch (e: any) {
        if (!(e.message && e.message.includes('duplicate column name'))) {
          logger.warn('device_confirmation_sessions migration skipped', { error: e.message });
        }
      }
    }

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
    hardwareContext?: {
      policyDigest?: string;
      challenge?: string;
      breakerTarget?: string;
      interlockAction?: string;
    };
    releaseTtlMs?: number;
    actorId: string;
    actorEmail?: string;
    actorIp?: string;
  }): Promise<DeviceConfirmationSessionRecord> {
    this.assertPrepared();
    if (!this.gatewayEmitter) {
      throw new Error('backend.device_gateway_unavailable');
    }

    // SECURITY FIX R3 / V2.4: fail-closed on missing hardware context.
    // An attacker who can call createPhysicalConfirmation must not be
    // able to forge a session by omitting policyDigest / breakerTarget
    // — those fields are part of the signed hardware grant and a
    // missing value means the companion cannot enforce the policy.
    const hardwareContext = input.hardwareContext;
    if (!hardwareContext || typeof hardwareContext !== 'object') {
      throw new Error('backend.hardware_context_policy_digest_required');
    }
    const policyDigest = String(hardwareContext.policyDigest || '').trim();
    const breakerTarget = String(hardwareContext.breakerTarget || '').trim();
    if (!policyDigest) {
      throw new Error('backend.hardware_context_policy_digest_required');
    }
    if (!breakerTarget) {
      throw new Error('backend.hardware_context_breaker_target_required');
    }

    const id = randomUUID();
    const createdAtMs = Date.now();
    const createdAt = new Date(createdAtMs).toISOString();
    const payload = input.payload || {};
    const releaseTtlMs = Math.max(1000, Number(input.releaseTtlMs || 120_000));
    const expiresAt = new Date(createdAtMs + releaseTtlMs).toISOString();
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
        accepted,
        hardwareContext: {
          policyDigest,
          challenge: String(hardwareContext.challenge || ''),
          breakerTarget,
          interlockAction: String(hardwareContext.interlockAction || '')
        },
        expiresAt,
        releaseTtlMs
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

    const replayedAt = new Date().toISOString();
    getDatabase().prepare(`
      UPDATE device_confirmation_sessions
      SET status = 'claiming_physical_confirmation', updated_at = ?
      WHERE id = ? AND device_id = ? AND status = 'pending_physical_confirmation'
    `).run(replayedAt, confirmationSessionId, deviceId);

    const existing = getDatabase().prepare(`
      SELECT *
      FROM device_confirmation_sessions
      WHERE id = ? AND device_id = ? AND status = 'claiming_physical_confirmation'
      LIMIT 1
    `).get(confirmationSessionId, deviceId) as any;

    if (!existing) {
      const replayExisting = getDatabase().prepare(`
        SELECT result_json
        FROM device_confirmation_sessions
        WHERE id = ? AND device_id = ?
        LIMIT 1
      `).get(confirmationSessionId, deviceId) as any;
      if (replayExisting) {
        const replayResult = {
          ...parseJson(replayExisting.result_json, {}),
          replayRejected: {
            reason: 'confirmation_session_replay_or_not_pending',
            ack: payload,
            at: replayedAt
          }
        };
        getDatabase().prepare(`
          UPDATE device_confirmation_sessions
          SET status = 'rejected', result_json = ?, updated_at = ?
          WHERE id = ? AND device_id = ? AND status != 'pending_physical_confirmation'
        `).run(JSON.stringify(replayResult), replayedAt, confirmationSessionId, deviceId);
      }
      return;
    }

    const device = getDeviceById(deviceId) as any;
    const publicKeyPem = device?.physicalAuth?.publicKeyPem;

    // SECURITY FIX R3 / V2.4: parse the stored hardwareContext that was
    // attached at session-creation time. The ack's grant MUST match
    // every field exactly — a forged policyDigest / breakerTarget /
    // challenge (even one signed with the real hardware key) must be
    // rejected.
    const storedResult = parseJson<any>(existing.result_json, {});
    const storedHC = storedResult?.hardwareContext || {};
    const storedPolicyDigest = String(storedHC.policyDigest || '');
    const storedBreakerTarget = String(storedHC.breakerTarget || '');
    const storedChallenge = String(storedHC.challenge || '');
    const storedInterlock = String(storedHC.interlockAction || '');

    // SECURITY FIX R3 / V2.4: NaN-poisoning defense for expiresAt.
    // An attacker can submit "expiresAt": "not-a-date" — we MUST refuse
    // before any comparison that would coerce to NaN.
    const sessionExpiresAt = String(storedResult?.expiresAt || this.mapConfirmationRow(existing).expiresAt || '');
    const ackExpiresAt = String(payload?.expiresAt || '').trim();
    const expiresAtMs = ackExpiresAt ? Date.parse(ackExpiresAt) : NaN;
    const sessionExpiresAtMs = sessionExpiresAt ? Date.parse(sessionExpiresAt) : NaN;
    const expiryParseValid = Number.isFinite(expiresAtMs) && Number.isFinite(sessionExpiresAtMs);
    const expiryMatchesSession = ackExpiresAt === sessionExpiresAt;
    const expiryStillValid = expiryParseValid && Date.now() <= expiresAtMs;
    if (!expiryParseValid) {
      getDatabase().prepare(`
        UPDATE device_confirmation_sessions
        SET status = 'rejected', result_json = ?, updated_at = ?
        WHERE id = ? AND device_id = ? AND status = 'claiming_physical_confirmation'
      `).run(
        JSON.stringify({ reason: 'session_expires_at_unparseable', ack: payload }),
        new Date().toISOString(),
        confirmationSessionId,
        deviceId
      );
      return;
    }

    let verified = false;
    let policyDigestMatch = false;
    let breakerTargetMatch = false;
    let challengeMatch = false;
    let interlockMatch = false;
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

      // Strict equality on every hardwareContext field.
      policyDigestMatch = storedPolicyDigest.length > 0
        && String(payload?.policyDigest || '') === storedPolicyDigest;
      breakerTargetMatch = storedBreakerTarget.length > 0
        && String(payload?.breakerTarget || '') === storedBreakerTarget;
      challengeMatch = !storedChallenge
        || String(payload?.challenge || '') === storedChallenge;
      interlockMatch = !storedInterlock
        || String(payload?.interlockAction || '') === storedInterlock;
    }

    // SECURITY FIX R3 / V2.4: strict === true for the confirmed flag.
    // Boolean('false') is truthy in JS — we MUST reject the literal
    // string "false" / "true" (and "0", "1", etc.) and accept only the
    // boolean primitive.
    const isConfirmed = payload?.confirmed === true;
    const allHardwareContextMatch = policyDigestMatch && breakerTargetMatch && challengeMatch && interlockMatch;
    const confirmed = isConfirmed
      && Boolean(payload.signature)
      && verified
      && allHardwareContextMatch
      && expiryMatchesSession
      && expiryStillValid;

    // Determine the rejection reason for forensics
    let rejectionReason: string | null = null;
    if (!isConfirmed) rejectionReason = 'missing_signature_or_confirm';
    else if (!payload.signature) rejectionReason = 'invalid_signature';
    else if (!verified) rejectionReason = 'invalid_signature';
    else if (!policyDigestMatch) rejectionReason = 'policy_digest_mismatch';
    else if (!breakerTargetMatch) rejectionReason = 'breaker_target_mismatch';
    else if (!challengeMatch) rejectionReason = 'challenge_mismatch';
    else if (!interlockMatch) rejectionReason = 'interlock_action_mismatch';
    else if (!expiryMatchesSession) rejectionReason = 'session_expires_at_mismatch';
    else if (!expiryStillValid) rejectionReason = 'session_expired';

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
      dispatchResult,
      reason: rejectionReason
    };
    if (payload.signature) {
      result.verified = verified;
    }
    result.hardwareContextMatch = {
      policyDigest: policyDigestMatch,
      breakerTarget: breakerTargetMatch,
      challenge: challengeMatch,
      interlockAction: interlockMatch
    };
    result.expiryCheck = {
      ackExpiresAt,
      sessionExpiresAt,
      matchesSession: expiryMatchesSession,
      stillValid: expiryStillValid
    };

    getDatabase().prepare(`
      UPDATE device_confirmation_sessions
      SET status = ?, result_json = ?, updated_at = ?, confirmed_at = ?
      WHERE id = ? AND device_id = ? AND status = 'claiming_physical_confirmation'
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
    const result = parseJson<any>(row.result_json, {});
    // expiresAt is derived from createdAt + releaseTtlMs so we don't
    // need a schema migration. Default TTL is 120s.
    const ttlMs = Number(result?.releaseTtlMs || 120_000);
    const createdMs = row.created_at ? new Date(row.created_at).getTime() : Date.now();
    const storedExpiresAt = typeof result?.expiresAt === 'string' ? result.expiresAt : '';
    const expiresAt = storedExpiresAt || new Date(createdMs + ttlMs).toISOString();
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
      expiresAt,
      confirmedAt: row.confirmed_at || undefined,
      result,
      hardwareContext: result?.hardwareContext || undefined
    };
  }
}

export const deviceControlService = new DeviceControlService();
