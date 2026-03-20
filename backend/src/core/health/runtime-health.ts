import { PLATFORM_API_CONFIG } from '../../utils/model-access';
import { RuntimeProfile } from '../../config/platform-runtime';
import { artifactStoreService } from '../../services/artifact-store.service';
import { fastpathClientService } from '../../services/fastpath-client.service';
import { jobQueueService } from '../../services/job-queue.service';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';
import { runtimeEmulatorService } from '../../services/runtime-emulator.service';
import redisService from '../../security/redis.service';

export type DependencyStatus = 'healthy' | 'degraded' | 'unhealthy' | 'disabled';

export interface DependencyHealth {
  status: DependencyStatus;
  message: string;
  details?: Record<string, any>;
}

export interface RuntimeHealthSnapshot {
  status: 'healthy' | 'degraded' | 'unhealthy';
  liveness: {
    status: 'alive';
    timestamp: string;
  };
  readiness: {
    status: 'ready' | 'not_ready';
    blockers: string[];
  };
  dependencies: {
    redis: DependencyHealth;
    postgres: DependencyHealth;
    artifactStore: DependencyHealth;
    fastpath: DependencyHealth;
    aiProvider: DependencyHealth;
  };
  runtime: Record<string, any>;
  queueBackend: 'redis' | 'memory';
  agents: number;
  emulator: Record<string, any>;
}

function getAiProviderHealth(profile: RuntimeProfile): DependencyHealth {
  const configuredKey = String(process.env.PLATFORM_API_KEY || '').trim();
  if (!configuredKey) {
    return {
      status: profile === 'prod' ? 'degraded' : 'disabled',
      message: profile === 'prod'
        ? 'Cloud AI provider is not configured.'
        : 'Cloud AI provider is disabled outside production.',
      details: {
        provider: PLATFORM_API_CONFIG.providerId,
        protocol: PLATFORM_API_CONFIG.protocol,
        baseURL: PLATFORM_API_CONFIG.baseURL
      }
    };
  }

  return {
    status: 'healthy',
    message: 'Cloud AI provider configuration is present.',
    details: {
      provider: PLATFORM_API_CONFIG.providerId,
      protocol: PLATFORM_API_CONFIG.protocol,
      baseURL: PLATFORM_API_CONFIG.baseURL
    }
  };
}

export async function buildRuntimeHealthSnapshot(input: {
  runtime: Record<string, any> & { profile: RuntimeProfile; dbMode: string; sqliteFallbackEnabled: boolean; };
  agentCount: number;
}): Promise<RuntimeHealthSnapshot> {
  const timestamp = new Date().toISOString();
  const shadow = postgresShadowStoreService.describe();
  const artifactStore = artifactStoreService.describe();
  const emulator = runtimeEmulatorService.describe();
  const redis = await redisService.healthCheck();
  const fastpathHealthy = await fastpathClientService.health('global').catch(() => false);
  const blockers: string[] = [];

  const dependencies = {
    redis: redis.healthy
      ? {
          status: 'healthy' as const,
          message: 'Redis is connected.',
          details: { latencyMs: redis.latency ?? null }
        }
      : {
          status: redisService.isDisabled() ? 'disabled' as const : 'degraded' as const,
          message: redis.error || 'Redis is unavailable.',
          details: { disabled: redisService.isDisabled() }
        },
    postgres: shadow.enabled
      ? shadow.connected
        ? {
            status: 'healthy' as const,
            message: 'Postgres shadow store is connected.',
            details: shadow
          }
        : {
            status: 'unhealthy' as const,
            message: shadow.lastError || 'Postgres shadow store is unavailable.',
            details: shadow
          }
      : {
          status: 'disabled' as const,
          message: 'Postgres shadow store is disabled.',
          details: shadow
        },
    artifactStore: artifactStore.requestedMode === artifactStore.activeMode
      ? {
          status: 'healthy' as const,
          message: `Artifact store is using ${artifactStore.activeMode}.`,
          details: artifactStore
        }
      : {
          status: 'degraded' as const,
          message: `Artifact store fell back to ${artifactStore.activeMode}.`,
          details: artifactStore
        },
    fastpath: fastpathHealthy
      ? {
          status: 'healthy' as const,
          message: 'Fastpath is reachable.'
        }
      : {
          status: input.runtime.profile === 'prod' ? 'degraded' as const : 'disabled' as const,
          message: input.runtime.profile === 'prod'
            ? 'Fastpath is unavailable; fallback path will be used.'
            : 'Fastpath is disabled or unavailable in the current profile.'
        },
    aiProvider: getAiProviderHealth(input.runtime.profile)
  };

  if (input.runtime.dbMode === 'postgres' && dependencies.postgres.status !== 'healthy') {
    blockers.push('postgres');
  }

  const readiness = {
    status: blockers.length === 0 ? 'ready' as const : 'not_ready' as const,
    blockers
  };

  const degradedDependencies = Object.values(dependencies).filter((dependency) =>
    dependency.status === 'degraded' || dependency.status === 'unhealthy'
  );

  return {
    status: readiness.status === 'not_ready'
      ? 'unhealthy'
      : degradedDependencies.length > 0
        ? 'degraded'
        : 'healthy',
    liveness: {
      status: 'alive',
      timestamp
    },
    readiness,
    dependencies,
    runtime: {
      ...input.runtime,
      dbPrimaryMode: input.runtime.dbMode,
      sqliteFallbackEnabled: input.runtime.sqliteFallbackEnabled,
      shadowStore: shadow
    },
    queueBackend: jobQueueService.backend(),
    agents: input.agentCount,
    emulator
  };
}
