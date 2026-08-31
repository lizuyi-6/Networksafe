import axios from 'axios';
import nodemailer from 'nodemailer';
import auditLogger from '../security/audit-logger.service';
import { assertOutboundHostAllowedResolved, assertOutboundUrlAllowedResolvedPinned, createPinnedDnsContext } from '../security/outbound-url-guard';
import logger from '../utils/logger';
import type { AlertRecord } from './security-operations.service';
import {
  NotificationChannelConfig,
  NotificationDeliveryRecord,
  SeverityLevel,
  isSeverityAtLeast,
  platformConfigService
} from './platform-config.service';

function normalizeSeverity(value: AlertRecord['severity'] | SeverityLevel): SeverityLevel {
  const normalized = String(value || 'medium').toLowerCase();
  if (normalized === 'critical' || normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized;
  }
  return 'medium';
}

function buildNotificationPayload(alert: AlertRecord, severity: SeverityLevel) {
  return {
    alertId: alert.id,
    title: alert.title,
    message: alert.message,
    severity,
    type: alert.type,
    source: alert.source,
    status: alert.status,
    timestamp: alert.timestamp,
    fingerprint: String(alert.metadata?.fingerprint || alert.findingId || alert.id),
    metadata: alert.metadata || {}
  };
}

function dedupeKeyFor(alert: AlertRecord, channel: NotificationChannelConfig, severity: SeverityLevel): string {
  const fingerprint = String(alert.metadata?.fingerprint || alert.findingId || alert.id || alert.title);
  return `${fingerprint}|${channel.id}|${severity}`;
}

class NotificationDispatcherService {
  private queueTimer: NodeJS.Timeout | null = null;
  private drainScheduled = false;
  private inFlight = new Set<string>();

  startWorker(intervalMs = 5000): void {
    if (this.queueTimer) {
      return;
    }
    this.queueTimer = setInterval(() => {
      void this.processDueDeliveries();
    }, intervalMs);
    this.queueTimer.unref?.();
    this.scheduleDrain();
  }

  stopWorker(): void {
    if (this.queueTimer) {
      clearInterval(this.queueTimer);
      this.queueTimer = null;
    }
  }

  async dispatchAlert(tenantId: string, alert: AlertRecord): Promise<NotificationDeliveryRecord[]> {
    return this.enqueueAlert(tenantId, alert);
  }

  async enqueueAlert(tenantId: string, alert: AlertRecord): Promise<NotificationDeliveryRecord[]> {
    try {
      const config = await platformConfigService.getConfig(tenantId);
      if (!config.notifications.enabled) {
        return [];
      }

      const severity = normalizeSeverity(alert.severity);
      const channels = config.notifications.channels.filter((channel) =>
        channel.enabled && isSeverityAtLeast(severity, channel.minimumSeverity)
      );

      const dedupeWindowStart = new Date(Date.now() - config.notifications.dedupeWindowSeconds * 1000).toISOString();
      const payload = buildNotificationPayload(alert, severity);
      const deliveries: NotificationDeliveryRecord[] = [];

      for (const channel of channels) {
        const dedupeKey = dedupeKeyFor(alert, channel, severity);
        const existing = await platformConfigService.findNotificationDeliveryByDedupe(tenantId, dedupeKey, dedupeWindowStart);
        if (existing) {
          deliveries.push(await platformConfigService.createNotificationDelivery({
            tenantId,
            alertId: alert.id,
            channelId: channel.id,
            channelType: channel.type,
            channelLabel: channel.name,
            status: 'skipped',
            severity,
            target: channel.target,
            payload,
            response: {
              dedupedAgainst: existing.id
            },
            error: 'notification_deduped',
            attemptCount: 0,
            dedupeKey,
            terminalAt: new Date().toISOString()
          }));
          continue;
        }

        deliveries.push(await platformConfigService.createNotificationDelivery({
          tenantId,
          alertId: alert.id,
          channelId: channel.id,
          channelType: channel.type,
          channelLabel: channel.name,
          status: 'queued',
          severity,
          target: channel.target,
          payload,
          response: {},
          attemptCount: 0,
          dedupeKey,
          nextAttemptAt: new Date().toISOString()
        }));
      }

      this.scheduleDrain();
      return deliveries;
    } catch (error: any) {
      logger.warn('Notification enqueue skipped', {
        tenantId,
        alertId: alert.id,
        error: error?.message || 'unknown error'
      });
      return [];
    }
  }

  async testChannel(
    tenantId: string,
    channelId: string,
    actor: { id: string; email?: string; ip?: string }
  ): Promise<NotificationDeliveryRecord> {
    const config = await platformConfigService.getConfig(tenantId);
    const channel = config.notifications.channels.find((item) => item.id === channelId);

    if (!channel) {
      throw new Error('backend.notification_channel_not_found');
    }

    const alert: AlertRecord = {
      id: `test-${Date.now()}`,
      title: 'Test notification',
      message: 'This is a control-plane test notification from AetherGuard.',
      severity: 'High',
      type: 'system',
      source: 'config.notifications.test',
      time: 'Just now',
      status: 'open',
      timestamp: new Date().toISOString(),
      metadata: {
        test: true,
        fingerprint: `test:${channelId}:${Date.now()}`
      }
    };

    const delivery = await platformConfigService.createNotificationDelivery({
      tenantId,
      alertId: alert.id,
      channelId: channel.id,
      channelType: channel.type,
      channelLabel: channel.name,
      status: 'queued',
      severity: 'high',
      target: channel.target,
      payload: buildNotificationPayload(alert, 'high'),
      response: {},
      attemptCount: 0,
      dedupeKey: dedupeKeyFor(alert, channel, 'high'),
      nextAttemptAt: new Date().toISOString()
    });

    const processed = await this.processDelivery(delivery);

    await auditLogger.log({
      tenantId,
      eventType: 'notification_channel_tested',
      category: 'system',
      severity: processed.status === 'sent' ? 'info' : 'warning',
      actor: { type: 'user', id: actor.id, email: actor.email, ip: actor.ip },
      action: 'test_notification_channel',
      target: { type: 'server', id: channelId },
      details: {
        channelType: channel.type,
        channelName: channel.name,
        deliveryId: processed.id,
        status: processed.status
      },
      status: processed.status === 'sent' ? 'success' : 'failure'
    });

    return processed;
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) {
      return;
    }
    this.drainScheduled = true;
    setTimeout(() => {
      this.drainScheduled = false;
      void this.processDueDeliveries();
    }, 25).unref?.();
  }

  private async processDueDeliveries(limit = 25): Promise<void> {
    const due = await platformConfigService.listDueNotificationDeliveries(limit);
    for (const delivery of due) {
      if (this.inFlight.has(delivery.id)) {
        continue;
      }
      this.inFlight.add(delivery.id);
      try {
        await this.processDelivery(delivery);
      } finally {
        this.inFlight.delete(delivery.id);
      }
    }
  }

  private async processDelivery(delivery: NotificationDeliveryRecord): Promise<NotificationDeliveryRecord> {
    const config = await platformConfigService.getConfig(delivery.tenantId);
    const channel = config.notifications.channels.find((item) => item.id === delivery.channelId);
    if (!config.notifications.enabled || !channel || !channel.enabled) {
      return (await platformConfigService.updateNotificationDelivery(delivery.tenantId, delivery.id, {
        status: 'skipped',
        error: !config.notifications.enabled ? 'notifications_disabled' : 'notification_channel_disabled',
        terminalAt: new Date().toISOString(),
        nextAttemptAt: null as any
      })) || delivery;
    }

    const attemptCount = delivery.attemptCount + 1;
    await platformConfigService.updateNotificationDelivery(delivery.tenantId, delivery.id, {
      status: 'sending',
      attemptCount,
      error: undefined,
      nextAttemptAt: null as any
    });

    try {
      const response = await this.send(channel, delivery.payload);
      const sent = await platformConfigService.updateNotificationDelivery(delivery.tenantId, delivery.id, {
        status: 'sent',
        response,
        attemptCount,
        terminalAt: new Date().toISOString(),
        nextAttemptAt: null as any
      });

      await auditLogger.log({
        tenantId: delivery.tenantId,
        eventType: 'notification_sent',
        category: 'system',
        severity: 'info',
        actor: { type: 'system', id: 'notification-dispatcher' },
        action: 'dispatch_notification',
        target: { type: 'server', id: channel.id },
        details: {
          channelType: channel.type,
          channelName: channel.name,
          deliveryId: delivery.id,
          alertId: delivery.alertId || null,
          attemptCount
        },
        status: 'success'
      });

      return sent || delivery;
    } catch (error: any) {
      const retryDelay = config.notifications.retryDelaysSeconds[attemptCount - 1];
      const terminal = !Number.isFinite(retryDelay as number);
      const nextAttemptAt = terminal ? null : new Date(Date.now() + Number(retryDelay) * 1000).toISOString();

      const failed = await platformConfigService.updateNotificationDelivery(delivery.tenantId, delivery.id, {
        status: terminal ? 'failed' : 'retrying',
        error: error?.message || 'notification delivery failed',
        response: {
          name: error?.name || 'Error'
        },
        attemptCount,
        nextAttemptAt: nextAttemptAt as any,
        terminalAt: terminal ? new Date().toISOString() : null as any
      });

      await auditLogger.log({
        tenantId: delivery.tenantId,
        eventType: terminal ? 'notification_failed' : 'notification_retry_scheduled',
        category: 'system',
        severity: terminal ? 'warning' : 'info',
        actor: { type: 'system', id: 'notification-dispatcher' },
        action: 'dispatch_notification',
        target: { type: 'server', id: channel.id },
        details: {
          channelType: channel.type,
          channelName: channel.name,
          deliveryId: delivery.id,
          alertId: delivery.alertId || null,
          attemptCount,
          nextAttemptAt,
          error: error?.message || 'notification delivery failed'
        },
        status: terminal ? 'failure' : 'success'
      });

      return failed || delivery;
    }
  }

  private async send(channel: NotificationChannelConfig, payload: Record<string, any>): Promise<Record<string, any>> {
    if (channel.type === 'email' || channel.type === 'smtp') {
      return this.sendSmtp(channel, payload);
    }
    return this.sendWebhook(channel, payload);
  }

  private async sendWebhook(channel: NotificationChannelConfig, payload: Record<string, any>): Promise<Record<string, any>> {
    if (!channel.target) {
      throw new Error('backend.notification_target_required');
    }

    // SECURITY FIX (audit 2026-08, AG-B02): webhook targets are
    // admin-configurable URLs the backend POSTs to — enforce the outbound
    // URL guard at dispatch time (the security boundary, covers every entry
    // path). Cloud metadata endpoints are blocked unconditionally; private /
    // loopback targets require ALLOW_PRIVATE_WEBHOOKS=1 (explicit
    // acknowledgment for internal notification servers, default off).
    // The validated addresses are pinned into the request agents so a DNS
    // rebinding race cannot split validation from connection (R2-F002
    // follow-up).
    const allowPrivate = String(process.env.ALLOW_PRIVATE_WEBHOOKS || '').trim() === '1';
    let pinned: ReturnType<typeof createPinnedDnsContext>;
    try {
      const resolved = await assertOutboundUrlAllowedResolvedPinned(channel.target, { allowPrivate });
      pinned = createPinnedDnsContext(resolved);
    } catch (error: any) {
      logger.warn('Blocked webhook delivery to forbidden target', {
        target: channel.target,
        reason: error?.message
      });
      throw new Error(error?.message || 'backend.webhook_target_blocked');
    }

    const response = await axios.post(channel.target, payload, {
      timeout: 10000,
      // SECURITY FIX (R2-F002): never follow redirects on webhook delivery -
      // a 302 from an allowed host must not be able to bounce the POST into a
      // blocked target (cloud metadata / private ranges).
      maxRedirects: 0,
      lookup: pinned.lookup,
      httpAgent: pinned.httpAgent,
      httpsAgent: pinned.httpsAgent,
      headers: {
        'Content-Type': 'application/json',
        ...channel.headers
      },
      validateStatus: () => true
    });

    // SECURITY (R2-F002 follow-up): maxRedirects: 0 turns any 3xx into "the
    // redirect was refused, the POST never reached the configured target".
    // Treating that as success (status < 400) recorded deliveries as 'sent'
    // that never arrived — a 302 from an allowed host must fail the delivery
    // (fail-closed: the external state did NOT change).
    if (response.status >= 300) {
      throw new Error(`Webhook delivery failed with status ${response.status}`);
    }

    return {
      status: response.status,
      body: typeof response.data === 'string' ? response.data.slice(0, 500) : response.data
    };
  }

  private async sendSmtp(channel: NotificationChannelConfig, payload: Record<string, any>): Promise<Record<string, any>> {
    if (!channel.smtp.host || !channel.smtp.from || !channel.target) {
      throw new Error('backend.smtp_configuration_incomplete');
    }

    // SECURITY (audit 2026-08, N5-6): the SMTP relay host is
    // operator-configured and the dispatcher opens a raw TCP/TLS session to
    // it — enforce the same AG-B02 invariant as the webhook path: cloud
    // metadata endpoints are always blocked; private/loopback relays require
    // ALLOW_PRIVATE_SMTP=1 (internal mail hubs are common, but the operator
    // must opt in explicitly). Every resolved A/AAAA address is validated.
    // nodemailer does not accept a pinned lookup, so this shares the
    // validate-then-connect model used by the scanner probes.
    const allowPrivateRelay = String(process.env.ALLOW_PRIVATE_SMTP || '').trim() === '1';
    try {
      await assertOutboundHostAllowedResolved(channel.smtp.host, { allowPrivate: allowPrivateRelay });
    } catch (error: any) {
      logger.warn('Blocked SMTP delivery to forbidden relay host', {
        host: channel.smtp.host,
        reason: error?.message
      });
      throw new Error(error?.message || 'backend.smtp_relay_blocked');
    }

    const transporter = nodemailer.createTransport({
      host: channel.smtp.host,
      port: channel.smtp.port,
      secure: channel.smtp.secure,
      auth: channel.smtp.username
        ? {
            user: channel.smtp.username,
            pass: channel.smtp.password
          }
        : undefined
    });

    const info = await transporter.sendMail({
      from: channel.smtp.from,
      to: channel.target,
      subject: `[AetherGuard][${String(payload.severity || 'medium').toUpperCase()}] ${payload.title}`,
      text: [
        `Alert ID: ${payload.alertId}`,
        `Severity: ${payload.severity}`,
        `Source: ${payload.source}`,
        `Type: ${payload.type}`,
        '',
        payload.message
      ].join('\n')
    });

    return {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected
    };
  }
}

export const notificationDispatcherService = new NotificationDispatcherService();
