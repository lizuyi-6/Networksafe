describe('logger', () => {
  const originalEnv = process.env;
  const consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    consoleDebugSpy.mockClear();
    consoleInfoSpy.mockClear();
    consoleWarnSpy.mockClear();
    consoleErrorSpy.mockClear();
  });

  afterAll(() => {
    process.env = originalEnv;
    consoleDebugSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('suppresses debug logs in production by default', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.LOG_LEVEL;

    const logger = require('../../utils/logger').default;
    logger.debug('hidden');
    logger.info('visible');

    expect(consoleDebugSpy).not.toHaveBeenCalled();
    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
  });

  it('allows debug logs when LOG_LEVEL=debug', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'debug';

    const logger = require('../../utils/logger').default;
    logger.debug('visible');

    expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
  });

  it('suppresses info logs when LOG_LEVEL=warn', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'warn';

    const logger = require('../../utils/logger').default;
    logger.info('hidden');
    logger.warn('visible');

    expect(consoleInfoSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });
});
