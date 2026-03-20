import { isDemoAutoSeedEnabled } from '../config/app-mode';
import { initDatabase } from '../config/database';
import { bootstrapDatabase } from '../database/init';
import { ensureAgentOnboardingSchema } from '../modules/agent-onboarding/agent-onboarding.schema';
import { ensureDeploymentProfileSchema } from '../modules/deployments/deployment-profile.repository';
import { aiEndpointStoreService } from '../services/ai-endpoint-store.service';
import auditLogger from '../security/audit-logger.service';
import { auditSegmentService } from '../services/audit-segment.service';
import { benchmarkService } from '../services/benchmark.service';
import { detectionPipelineService } from '../services/detection-pipeline.service';
import { deviceControlService } from '../services/device-control.service';
import { platformConfigService } from '../services/platform-config.service';
import { scannerTaskService } from '../services/scanner-task.service';
import { securityOperationsService } from '../services/security-operations.service';
import { tenantOversightService } from '../services/tenant-oversight.service';
import { postgresShadowStoreService } from '../services/postgres-shadow-store.service';
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
  tenantOversightService.prepare();
  benchmarkService.prepare();
  detectionPipelineService.prepare();
  ensureAgentOnboardingSchema();
  ensureDeploymentProfileSchema();

  await bootstrapDatabase();
  if (isDemoAutoSeedEnabled()) {
    const { seedDatabase } = require('../database/seeds/demo_data');
    await seedDatabase({ clearExisting: false, verbose: true });
  }

  await postgresShadowStoreService.backfillSnapshot();

  logger.info('Persistence bootstrap complete');
}
