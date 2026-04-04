/**
 * App Mode Tests
 */

// Save and restore env vars
const originalAppMode = process.env.APP_MODE;
const originalEnableAttackSim = process.env.ENABLE_ATTACK_SIM;
const originalDemoAutoSeed = process.env.DEMO_AUTO_SEED;

import {
  getAppMode,
  setAppMode,
  isDemoMode,
  isAttackSimulatorEnabled,
  isDemoAutoSeedEnabled
} from '../../config/app-mode';

describe('app-mode', () => {
  beforeEach(() => {
    delete process.env.APP_MODE;
    delete process.env.ENABLE_ATTACK_SIM;
    delete process.env.DEMO_AUTO_SEED;
  });

  afterAll(() => {
    process.env.APP_MODE = originalAppMode;
    process.env.ENABLE_ATTACK_SIM = originalEnableAttackSim;
    process.env.DEMO_AUTO_SEED = originalDemoAutoSeed;
  });

  describe('getAppMode', () => {
    it('defaults to production', () => {
      expect(getAppMode()).toBe('production');
    });

    it('returns demo when APP_MODE=demo', () => {
      process.env.APP_MODE = 'demo';
      expect(getAppMode()).toBe('demo');
    });

    it('returns production for any other value', () => {
      process.env.APP_MODE = 'production';
      expect(getAppMode()).toBe('production');
      process.env.APP_MODE = 'staging';
      expect(getAppMode()).toBe('production');
    });
  });

  describe('setAppMode', () => {
    it('changes the mode', () => {
      process.env.APP_MODE = 'demo';
      setAppMode('production');
      expect(getAppMode()).toBe('production');
    });
  });

  describe('isDemoMode', () => {
    it('returns true in demo mode', () => {
      process.env.APP_MODE = 'demo';
      expect(isDemoMode()).toBe(true);
    });

    it('returns false in production', () => {
      expect(isDemoMode()).toBe(false);
    });
  });

  describe('isAttackSimulatorEnabled', () => {
    it('returns false in production mode', () => {
      expect(isAttackSimulatorEnabled()).toBe(false);
    });

    it('returns false in demo mode without flag', () => {
      process.env.APP_MODE = 'demo';
      expect(isAttackSimulatorEnabled()).toBe(false);
    });

    it('returns true in demo mode with flag', () => {
      process.env.APP_MODE = 'demo';
      process.env.ENABLE_ATTACK_SIM = 'true';
      expect(isAttackSimulatorEnabled()).toBe(true);
    });
  });

  describe('isDemoAutoSeedEnabled', () => {
    it('returns false in production mode', () => {
      expect(isDemoAutoSeedEnabled()).toBe(false);
    });

    it('returns false in demo mode without flag', () => {
      process.env.APP_MODE = 'demo';
      expect(isDemoAutoSeedEnabled()).toBe(false);
    });

    it('returns true in demo mode with flag', () => {
      process.env.APP_MODE = 'demo';
      process.env.DEMO_AUTO_SEED = 'true';
      expect(isDemoAutoSeedEnabled()).toBe(true);
    });
  });
});
