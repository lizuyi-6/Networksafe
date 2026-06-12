/**
 * SmartFixer Tests
 */

jest.mock('child_process', () => ({
  exec: jest.fn(),
  execSync: jest.fn(),
  spawn: jest.fn(() => ({
    on: jest.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') cb(0);
      return this;
    }),
    stdout: { on: jest.fn((event: string, cb: (data: Buffer) => void) => {
      if (event === 'data') cb(Buffer.from('output'));
    }) },
    stderr: { on: jest.fn() },
    kill: jest.fn(),
  })),
}));

jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../../scanner/execution-monitor', () => ({
  ExecutionMonitor: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0, duration: 100, success: true, command: 'test' }),
    on: jest.fn(),
    getExecutionId: jest.fn(() => 'test-exec-id'),
    isRunning: jest.fn(() => false),
    getCurrentOutput: jest.fn(() => ({ stdout: '', stderr: '' })),
  })),
}));
jest.mock('../../scanner/ai-engine', () => ({
  AIEngine: jest.fn().mockImplementation(() => ({
    diagnoseFailure: jest.fn().mockResolvedValue({ diagnosis: 'ai-diagnosis', alternativeSolution: 'ai-solution', explanation: 'explanation' }),
    analyzeExecutionOutput: jest.fn().mockResolvedValue({ status: 'normal' }),
    analyzeProblem: jest.fn().mockResolvedValue({ diagnosis: { rootCause: 'test', severity: 'medium', confidence: 0.8 }, solutions: [{ command: 'ufw enable', explanation: 'test', riskLevel: 'low', estimatedSuccess: 90 }] }),
  })),
}));

import { SmartFixer } from '../../scanner/smart-fixer';
import { Recommendation } from '../../database/models/scan-result';

// Test fixtures carry an extra `id` field the production Recommendation omits.
type TestRecommendation = Recommendation & { id: string };

describe('SmartFixer', () => {
  let fixer: SmartFixer;

  beforeEach(() => {
    jest.clearAllMocks();
    fixer = new SmartFixer({ maxAttempts: 3, enableAI: true });
  });

  describe('constructor', () => {
    it('creates instance with default options', () => {
      const defaultFixer = new SmartFixer();
      expect(defaultFixer).toBeInstanceOf(SmartFixer);
    });

    it('creates instance with custom options', () => {
      const customFixer = new SmartFixer({
        maxAttempts: 5,
        enableAI: true,
        executionTimeout: 30000
      });
      expect(customFixer).toBeInstanceOf(SmartFixer);
    });
  });

  describe('fixProblem with AI enabled', () => {
    it('uses AI recommendations when available', async () => {
      const recommendation: TestRecommendation = {
        id: '1',
        category: 'security',
        priority: 'high',
        title: 'Enable firewall',
        description: 'Enable UFW firewall',
        action: 'ufw enable',
        autoApplicable: true,
        risk: 'low',
      };

      const result = await fixer.fixProblem(recommendation);

      // With AI enabled and mock providing solutions, should use AI solution
      expect(result.attempts.length).toBeGreaterThan(0);
    });
  });

  describe('dryFix', () => {
    it('returns plan without executing', async () => {
      const recommendation: TestRecommendation = {
        id: '1',
        category: 'security',
        priority: 'high',
        title: 'Dry run test',
        description: 'Test dry run',
        action: 'ufw enable',
        autoApplicable: true,
        risk: 'low',
      };

      const result = await fixer.dryFix(recommendation);

      expect(result).toHaveProperty('aiAnalysis');
      expect(result).toHaveProperty('plannedAttempts');
      expect(result).toHaveProperty('estimatedTime');
      expect(result).toHaveProperty('risks');
    });
  });
});
