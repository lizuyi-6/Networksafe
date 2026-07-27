import { resolveBackendBindAddress } from '../../bootstrap/listen-config';

describe('resolveBackendBindAddress', () => {
  it('defaults NODE_ENV=production runtimes to IPv4 loopback', () => {
    expect(
      resolveBackendBindAddress({ nodeEnv: 'production', profile: 'dev' }, undefined)
    ).toBe('127.0.0.1');
  });

  it('defaults PROFILE=prod runtimes to IPv4 loopback', () => {
    expect(
      resolveBackendBindAddress({ nodeEnv: 'development', profile: 'prod' }, undefined)
    ).toBe('127.0.0.1');
  });

  it('preserves the Node default listener behavior outside production', () => {
    expect(
      resolveBackendBindAddress({ nodeEnv: 'development', profile: 'dev' }, undefined)
    ).toBeUndefined();
  });

  it('allows an explicit Compose network listener override', () => {
    expect(
      resolveBackendBindAddress(
        { nodeEnv: 'production', profile: 'prod' },
        '0.0.0.0'
      )
    ).toBe('0.0.0.0');
  });

  it('treats a whitespace-only override as unset', () => {
    expect(
      resolveBackendBindAddress(
        { nodeEnv: 'production', profile: 'prod' },
        '   '
      )
    ).toBe('127.0.0.1');
  });
});
