import { resolveSecurityDetectionConfig } from '../detection-config';

describe('resolveSecurityDetectionConfig', () => {
  it('defaults to disabled with no env vars set', () => {
    const config = resolveSecurityDetectionConfig({});
    expect(config.enabled).toBe(false);
    expect(config.mode).toBe('disabled');
  });

  it('requires explicit SECURITY_DETECTION_ENGINE_ENABLED=true to enable', () => {
    expect(resolveSecurityDetectionConfig({ SECURITY_DETECTION_ENGINE_ENABLED: 'yes' }).enabled).toBe(false);
    expect(resolveSecurityDetectionConfig({ SECURITY_DETECTION_ENGINE_ENABLED: '1' }).enabled).toBe(false);
    expect(resolveSecurityDetectionConfig({ SECURITY_DETECTION_ENGINE_ENABLED: 'true' }).enabled).toBe(true);
  });

  it('forces mode=disabled when enabled=false even if mode=shadow', () => {
    const config = resolveSecurityDetectionConfig({
      SECURITY_DETECTION_ENGINE_ENABLED: 'false',
      SECURITY_DETECTION_ENGINE_MODE: 'shadow'
    });
    expect(config.enabled).toBe(false);
    expect(config.mode).toBe('disabled');
  });

  it('parses shadow mode when explicitly enabled', () => {
    const config = resolveSecurityDetectionConfig({
      SECURITY_DETECTION_ENGINE_ENABLED: 'true',
      SECURITY_DETECTION_ENGINE_MODE: 'shadow'
    });
    expect(config.mode).toBe('shadow');
  });

  it('treats unknown mode as disabled (safe default)', () => {
    const config = resolveSecurityDetectionConfig({
      SECURITY_DETECTION_ENGINE_ENABLED: 'true',
      SECURITY_DETECTION_ENGINE_MODE: 'enforced_but_bogus'
    });
    expect(config.mode).toBe('disabled');
  });

  it('clamps sampleRate into [0,1]', () => {
    const high = resolveSecurityDetectionConfig({
      SECURITY_DETECTION_ENGINE_ENABLED: 'true',
      SECURITY_DETECTION_ENGINE_MODE: 'shadow',
      SECURITY_DETECTION_SAMPLE_RATE: '2.5'
    });
    expect(high.sampleRate).toBe(1);
    const low = resolveSecurityDetectionConfig({
      SECURITY_DETECTION_ENGINE_ENABLED: 'true',
      SECURITY_DETECTION_ENGINE_MODE: 'shadow',
      SECURITY_DETECTION_SAMPLE_RATE: '-3'
    });
    expect(low.sampleRate).toBe(0);
  });

  it('falls back to defaults for non-positive integers', () => {
    const config = resolveSecurityDetectionConfig({
      SECURITY_DETECTION_ENGINE_ENABLED: 'true',
      SECURITY_DETECTION_ENGINE_MODE: 'shadow',
      SECURITY_DETECTION_TIMEOUT_MS: '0',
      SECURITY_DETECTION_QUEUE_MAX_LENGTH: '-5'
    });
    expect(config.timeoutMs).toBeGreaterThan(0);
    expect(config.queueMaxLength).toBeGreaterThan(0);
  });
});
