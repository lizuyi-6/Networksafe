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
});
