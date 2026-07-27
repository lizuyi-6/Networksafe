import type { RuntimeEnvironmentReport } from './runtime-env';

const PRODUCTION_LOOPBACK_ADDRESS = '127.0.0.1';

export function resolveBackendBindAddress(
  environmentReport: Pick<RuntimeEnvironmentReport, 'nodeEnv' | 'profile'>,
  configuredAddress: string | undefined = process.env.BACKEND_BIND_ADDRESS
): string | undefined {
  const normalizedConfiguredAddress = String(configuredAddress || '').trim();
  if (normalizedConfiguredAddress) {
    return normalizedConfiguredAddress;
  }

  const isProductionRuntime =
    environmentReport.nodeEnv === 'production' || environmentReport.profile === 'prod';

  return isProductionRuntime ? PRODUCTION_LOOPBACK_ADDRESS : undefined;
}
