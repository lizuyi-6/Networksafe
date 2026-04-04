/**
 * ZhipuClient Tests
 */

jest.mock('axios');
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import axios from 'axios';
import { ZhipuClient, testZhipuAI } from '../../scanner/zhipu-client';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ZhipuClient', () => {
  let client: ZhipuClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new ZhipuClient('test-api-key');
  });

  describe('constructor', () => {
    it('creates instance with api key', () => {
      expect(client).toBeInstanceOf(ZhipuClient);
    });
  });

  describe('generateCompletion', () => {
    it('returns completion on success', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          content: [{ text: 'test completion' }]
        }
      });

      const result = await client.generateCompletion('test prompt');

      expect(result).toBe('test completion');
    });

    it('throws on error', async () => {
      mockedAxios.post.mockRejectedValue(new Error('API error'));

      await expect(client.generateCompletion('test')).rejects.toThrow('API error');
    });
  });

  describe('chatCompletion', () => {
    it('returns chat completion on success', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          content: [{ text: 'chat response' }]
        }
      });

      const result = await client.chatCompletion([{ role: 'user', content: 'hi' }]);

      expect(result).toBe('chat response');
    });

    it('throws on error', async () => {
      mockedAxios.post.mockRejectedValue(new Error('API error'));

      await expect(client.chatCompletion([{ role: 'user', content: 'hi' }])).rejects.toThrow('API error');
    });
  });

  describe('testConnection', () => {
    it('returns true on success', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          content: [{ text: 'ok' }]
        }
      });

      const result = await client.testConnection();

      expect(result).toBe(true);
    });

    it('returns false on error', async () => {
      mockedAxios.post.mockRejectedValue(new Error('connection failed'));

      const result = await client.testConnection();

      expect(result).toBe(false);
    });
  });

  describe('getAvailableModels', () => {
    it('returns array of models', () => {
      const models = client.getAvailableModels();

      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
      expect(models).toContain('glm-4');
    });
  });
});

describe('testZhipuAI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns success with latency on valid key', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        content: [{ text: 'ok' }]
      }
    });

    const result = await testZhipuAI('valid-key');

    expect(result.success).toBe(true);
    expect(typeof result.latency).toBe('number');
    expect(result.latency).toBeGreaterThanOrEqual(0);
  });

  it('returns failure on invalid key', async () => {
    mockedAxios.post.mockRejectedValue(new Error('Invalid API key'));

    const result = await testZhipuAI('invalid-key');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid API key');
  });
});
