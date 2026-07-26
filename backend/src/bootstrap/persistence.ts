import { isDemoAutoSeedEnabled } from '../config/app-mode';
import { initDatabase } from '../config/database';
import { bootstrapDatabase } from '../database/init';
import { ensureAgentOnboardingSchema } from '../modules/agent-onboarding/agent-onboarding.schema';
import { ensureDeploymentProfileSchema } from '../modules/deployments/deployment-profile.repository';
import { ensureAnnouncementsSchema } from '../modules/announcements/announcements.repository';
import { aiEndpointStoreService } from '../services/ai-endpoint-store.service';
import auditLogger from '../security/audit-logger.service';
import { auditSegmentService } from '../services/audit-segment.service';
import { benchmarkService } from '../services/benchmark.service';
import { detectionPipelineService } from '../services/detection-pipeline.service';
import { deviceControlService } from '../services/device-control.service';
import { hardwareAuthorizationService } from '../services/hardware-authorization.service';
import { finalDefenseService } from '../services/final-defense.service';
import { platformConfigService } from '../services/platform-config.service';
import { scannerTaskService } from '../services/scanner-task.service';
import { securityOperationsService } from '../services/security-operations.service';
import { tenantOversightService } from '../services/tenant-oversight.service';
import { postgresShadowStoreService } from '../services/postgres-shadow-store.service';
import { deploymentRunService } from '../services/deployment-run.service';
import logger from '../utils/logger';

export async function bootstrapPersistence(): Promise<void> {
  await initDatabase();
  await postgresShadowStoreService.init();

  // Centralize schema creation for modules that were previously self-initializing on first request.
  platformConfigService.prepare();
  aiEndpointStoreService.prepare();
  auditLogger.prepare();
  auditSegmentService.prepare();
  securityOperationsService.prepare();
  scannerTaskService.prepare();
  deviceControlService.prepare();
  hardwareAuthorizationService.prepare();
  finalDefenseService.prepare();
  tenantOversightService.prepare();
  benchmarkService.prepare();
  detectionPipelineService.prepare();
  deploymentRunService.prepare();
  ensureAgentOnboardingSchema();
  ensureDeploymentProfileSchema();
  ensureAnnouncementsSchema();

  await bootstrapDatabase();
  if (isDemoAutoSeedEnabled()) {
    const { seedDatabase } = require('../database/seeds/demo_data');
    await seedDatabase({ clearExisting: false, verbose: true });
  }

  auditLogger.startBackgroundJobs();

  // Backfill the Postgres shadow store WITHOUT blocking startup: a full
  // backfill over thousands of audit rows (serial INSERT-per-row) can take
  // minutes and freezes the event loop on each SQLite `.all()`, which also
  // starves every async timer (including our shadow-query timeout). The
  // resync loop (startResyncLoop, already scheduled in start()) will catch
  // the store up shortly after listen(). Reads fall back to SQLite until then.
  void postgresShadowStoreService.backfillSnapshot().catch((error) => {
    logger.warn('Shadow store initial backfill failed; resync loop will retry', { error: error?.message });
  });

  logger.info('Persistence bootstrap complete');
}
