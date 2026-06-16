describe('deployment bundle signing', () => {
  const previousSecret = process.env.DEPLOYMENT_BUNDLE_SIGNING_SECRET;
  const previousDeviceSecret = process.env.DEVICE_COMMAND_SECRET;

  beforeEach(() => {
    jest.resetModules();
    process.env.DEPLOYMENT_BUNDLE_SIGNING_SECRET = 'test-deployment-signing-secret-32';
    delete process.env.DEVICE_COMMAND_SECRET;
  });

  afterAll(() => {
    if (previousSecret === undefined) {
      delete process.env.DEPLOYMENT_BUNDLE_SIGNING_SECRET;
    } else {
      process.env.DEPLOYMENT_BUNDLE_SIGNING_SECRET = previousSecret;
    }
    if (previousDeviceSecret === undefined) {
      delete process.env.DEVICE_COMMAND_SECRET;
    } else {
      process.env.DEVICE_COMMAND_SECRET = previousDeviceSecret;
    }
  });

  it('verifies unchanged payloads and rejects tampering', async () => {
    const signing = await import('../../security/deployment-bundle-signing');
    const payload = {
      runId: 'run-1',
      tenantId: 'tenant-1',
      requestType: 'INSTALL',
      checksum: 'abc123'
    };

    const signature = signing.signDeploymentBundlePayload(payload);

    expect(signing.verifyDeploymentBundlePayload(payload, signature)).toBe(true);
    expect(signing.verifyDeploymentBundlePayload({ ...payload, checksum: 'tampered' }, signature)).toBe(false);
  });

  it('reports unconfigured signing when no sufficiently strong secret exists', async () => {
    delete process.env.DEPLOYMENT_BUNDLE_SIGNING_SECRET;
    delete process.env.DEVICE_COMMAND_SECRET;
    jest.resetModules();

    const signing = await import('../../security/deployment-bundle-signing');
    expect(signing.isDeploymentBundleSigningConfigured()).toBe(false);
  });
});
