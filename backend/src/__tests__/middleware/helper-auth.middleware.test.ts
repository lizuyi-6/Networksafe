import { authenticateHelperRequest } from '../../middleware/helper-auth.middleware';

function buildRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  } as any;
}

describe('authenticateHelperRequest', () => {
  const previousHelperSecret = process.env.SERIAL_HELPER_SHARED_SECRET;
  const previousDeviceSecret = process.env.DEVICE_COMMAND_SECRET;
  const previousExtraSecrets = process.env.SERIAL_HELPER_EXTRA_SECRETS;

  afterEach(() => {
    if (previousHelperSecret === undefined) {
      delete process.env.SERIAL_HELPER_SHARED_SECRET;
    } else {
      process.env.SERIAL_HELPER_SHARED_SECRET = previousHelperSecret;
    }
    if (previousDeviceSecret === undefined) {
      delete process.env.DEVICE_COMMAND_SECRET;
    } else {
      process.env.DEVICE_COMMAND_SECRET = previousDeviceSecret;
    }
    if (previousExtraSecrets === undefined) {
      delete process.env.SERIAL_HELPER_EXTRA_SECRETS;
    } else {
      process.env.SERIAL_HELPER_EXTRA_SECRETS = previousExtraSecrets;
    }
  });

  it('accepts the configured helper shared secret', () => {
    process.env.SERIAL_HELPER_SHARED_SECRET = 'helper-secret-32-characters-minimum';
    const req = { headers: { 'x-aetherguard-helper-secret': process.env.SERIAL_HELPER_SHARED_SECRET } } as any;
    const res = buildRes();
    const next = jest.fn();

    authenticateHelperRequest(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects missing or invalid helper secrets', () => {
    process.env.SERIAL_HELPER_SHARED_SECRET = 'helper-secret-32-characters-minimum';
    const req = { headers: { 'x-aetherguard-helper-secret': 'wrong' } } as any;
    const res = buildRes();
    const next = jest.fn();

    authenticateHelperRequest(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // ── AG-B04 (audit 2026-08): named per-helper keys with revocable scope ──

  const KEY_A = 'appliance-a-key-32-characters-minimum!';
  const KEY_B = 'appliance-b-key-32-characters-minimum!';

  function configureNamedKeys(): void {
    process.env.SERIAL_HELPER_SHARED_SECRET = 'helper-secret-32-characters-minimum';
    process.env.SERIAL_HELPER_EXTRA_SECRETS = `appliance-a:${KEY_A},appliance-b:${KEY_B}`;
  }

  it('accepts a named per-helper key and attaches the matched key id', () => {
    configureNamedKeys();
    const req = {
      headers: {
        'x-aetherguard-helper-key-id': 'appliance-a',
        'x-aetherguard-helper-secret': KEY_A
      }
    } as any;
    const res = buildRes();
    const next = jest.fn();

    authenticateHelperRequest(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.helperKeyId).toBe('appliance-a');
  });

  it('rejects a REVOKED named key id even though other keys still work', () => {
    // Revocation = removing appliance-a from SERIAL_HELPER_EXTRA_SECRETS.
    process.env.SERIAL_HELPER_SHARED_SECRET = 'helper-secret-32-characters-minimum';
    process.env.SERIAL_HELPER_EXTRA_SECRETS = `appliance-b:${KEY_B}`;

    const req = {
      headers: {
        'x-aetherguard-helper-key-id': 'appliance-a',
        'x-aetherguard-helper-secret': KEY_A
      }
    } as any;
    const res = buildRes();
    const next = jest.fn();

    authenticateHelperRequest(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('named-key path does NOT fall back to the shared secret', () => {
    configureNamedKeys();
    // Requests naming a key id but presenting the SHARED secret must fail —
    // otherwise a revoked appliance could keep authenticating by naming any
    // still-valid key id and sending the shared secret.
    const req = {
      headers: {
        'x-aetherguard-helper-key-id': 'appliance-a',
        'x-aetherguard-helper-secret': 'helper-secret-32-characters-minimum'
      }
    } as any;
    const res = buildRes();
    const next = jest.fn();

    authenticateHelperRequest(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('named-key path rejects a secret from a DIFFERENT key id', () => {
    configureNamedKeys();
    const req = {
      headers: {
        'x-aetherguard-helper-key-id': 'appliance-a',
        'x-aetherguard-helper-secret': KEY_B
      }
    } as any;
    const res = buildRes();
    const next = jest.fn();

    authenticateHelperRequest(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('legacy anonymous requests still authenticate with any configured secret', () => {
    configureNamedKeys();
    const res = buildRes();

    for (const secret of ['helper-secret-32-characters-minimum', KEY_A, KEY_B]) {
      const req = { headers: { 'x-aetherguard-helper-secret': secret } } as any;
      const next = jest.fn();
      authenticateHelperRequest(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it('bearer authorization header is accepted for named keys too', () => {
    configureNamedKeys();
    const req = {
      headers: {
        'x-aetherguard-helper-key-id': 'appliance-b',
        authorization: `Bearer ${KEY_B}`
      }
    } as any;
    const res = buildRes();
    const next = jest.fn();

    authenticateHelperRequest(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.helperKeyId).toBe('appliance-b');
  });

  it('503 when nothing is configured', () => {
    delete process.env.SERIAL_HELPER_SHARED_SECRET;
    delete process.env.DEVICE_COMMAND_SECRET;
    delete process.env.SERIAL_HELPER_EXTRA_SECRETS;

    const req = { headers: {} } as any;
    const res = buildRes();
    const next = jest.fn();

    authenticateHelperRequest(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
