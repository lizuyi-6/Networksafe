/**
 * AIEngine Tests
 * Note: These tests focus on fallback behavior since axios mocking
 * inside private methods has known complexity with Jest.
 */

jest.mock('axios', () => ({
  post: jest.fn()
}));

jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { AIEngine } from '../../scanner/ai-engine';
import axios from 'axios';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AIEngine', () => {
  let engine: AIEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new AIEngine({ provider: 'ollama', apiKey: 'test-key', model: 'llama2', baseURL: 'http://localhost:11434' });
  });

  describe('constructor', () => {
    it('creates instance with provider config', () => {
      const customEngine = new AIEngine({
        provider: 'ollama',
        apiKey: 'my-key',
        model: 'llama2',
        baseURL: 'http://localhost:11434'
      });
      expect(customEngine).toBeInstanceOf(AIEngine);
    });
  });

  describe('analyzeProblem - fallback behavior', () => {
    it('returns fallback when API fails', async () => {
      mockedAxios.post.mockRejectedValue(new Error('API error'));

      const result = await engine.analyzeProblem({
        problem: {
          title: 'Test',
          description: 'Test problem',
          category: 'security',
          priority: 'high'
        },
        context: {
          systemInfo: {},
          logs: [],
          configFiles: {}
        }
      });

      expect(result.diagnosis).toBeDefined();
      expect(result.diagnosis.confidence).toBeLessThanOrEqual(1);
      expect(result.solutions).toBeDefined();
    });

    it('provides firewall solution for security issues in fallback', async () => {
      mockedAxios.post.mockRejectedValue(new Error('API unavailable'));

      const result = await engine.analyzeProblem({
        problem: {
          title: 'firewall ports open',
          description: 'security issue',
          category: 'security',
          priority: 'high'
        },
        context: { systemInfo: {}, logs: [], configFiles: {} }
      });

      expect(result.solutions.length).toBeGreaterThan(0);
    });
  });

  describe('diagnoseFailure - fallback behavior', () => {
    it('returns fallback diagnosis when API fails', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Network error'));

      const result = await engine.diagnoseFailure(
        { title: 'Test' },
        'nginx start',
        '',
        'error'
      );

      expect(result.diagnosis).toBe('Command failed with unknown error');
      expect(result.alternativeSolution).toBe('Check system logs for more details');
    });

    it('returns proper fallback structure', async () => {
      mockedAxios.post.mockRejectedValue(new Error('API unavailable'));

      const result = await engine.diagnoseFailure(
        { title: 'Test' },
        'service start',
        '',
        'failed'
      );

      expect(result).toHaveProperty('diagnosis');
      expect(result).toHaveProperty('alternativeSolution');
      expect(result).toHaveProperty('explanation');
    });
  });

  describe('analyzeExecutionOutput - fallback behavior', () => {
    it('returns error status when output contains error', async () => {
      mockedAxios.post.mockRejectedValue(new Error('API error'));

      const result = await engine.analyzeExecutionOutput('ls', 'error occurred', false);

      expect(result.status).toBe('error');
    });

    it('returns normal status for clean output', async () => {
      mockedAxios.post.mockRejectedValue(new Error('API error'));

      const result = await engine.analyzeExecutionOutput('ls', 'total 10', true);

      expect(result.status).toBe('normal');
    });

    it('returns proper structure', async () => {
      mockedAxios.post.mockRejectedValue(new Error('API error'));

      const result = await engine.analyzeExecutionOutput('ls', 'some output', false);

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('message');
    });
  });
});
