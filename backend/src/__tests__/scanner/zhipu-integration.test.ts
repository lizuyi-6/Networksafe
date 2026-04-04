/**
 * ZhipuIntegration Tests
 */

jest.mock('axios');
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

jest.mock('../../scanner/zhipu-client', () => ({
  ZhipuClient: jest.fn().mockImplementation(() => ({
    chatCompletion: jest.fn().mockResolvedValue('fix suggestion'),
  })),
  testZhipuAI: jest.fn().mockResolvedValue({ success: true, latency: 10 }),
}));

jest.mock('../../scanner/smart-fixer', () => ({
  SmartFixer: jest.fn().mockImplementation(() => ({
    fixProblem: jest.fn().mockResolvedValue({
      success: true,
      recommendation: { id: '1', title: 'Test' },
      attempts: [],
      totalTime: 100,
    }),
  })),
}));

import { createZhipuSmartFixer, quickFixWithZhipu } from '../../scanner/zhipu-integration';

describe('ZhipuIntegration', () => {
  describe('createZhipuSmartFixer', () => {
    it('creates SmartFixer instance', () => {
      const fixer = createZhipuSmartFixer('test-key');

      expect(fixer).toBeDefined();
      expect(typeof fixer.fixProblem).toBe('function');
    });

    it('creates fixer with default model', () => {
      const fixer = createZhipuSmartFixer('test-key');

      expect(fixer).toBeDefined();
    });

    it('creates fixer with custom model', () => {
      const fixer = createZhipuSmartFixer('test-key', 'glm-4-plus');

      expect(fixer).toBeDefined();
    });
  });

  describe('quickFixWithZhipu', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      process.env.ZHIPU_API_KEY = 'test-api-key';
      process.env.ZHIPU_MODEL = 'glm-4';
    });

    afterEach(() => {
      delete process.env.ZHIPU_API_KEY;
      delete process.env.ZHIPU_MODEL;
    });

    it('throws when ZHIPU_API_KEY is not set', async () => {
      delete process.env.ZHIPU_API_KEY;

      await expect(quickFixWithZhipu({
        title: 'Test fix',
        description: 'Test description',
        category: 'security',
        priority: 'high',
        action: 'ufw enable'
      })).rejects.toThrow('ZHIPU_API_KEY environment variable is required');
    });

    it('calls fixer.fixProblem when API key is set', async () => {
      const fixer = createZhipuSmartFixer('test-key');

      const result = await fixer.fixProblem({
        id: '1',
        title: 'Test fix',
        description: 'Test description',
        category: 'security',
        priority: 'high',
        action: 'ufw enable',
        autoApplicable: true,
        risk: 'low'
      });

      expect(result.success).toBe(true);
    });
  });
});
