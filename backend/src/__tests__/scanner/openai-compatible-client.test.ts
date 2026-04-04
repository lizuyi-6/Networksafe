/**
 * OpenAICompatibleClient Tests
 */

jest.mock('axios');
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import axios from 'axios';
import { OpenAICompatibleClient, createDashScopeClient, testDashScope } from '../../scanner/openai-compatible-client';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('OpenAICompatibleClient', () => {
  let client: OpenAICompatibleClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new OpenAICompatibleClient({
      apiKey: 'test-key',
      baseURL: 'http://test.com',
      model: 'test-model'
    });
  });

  describe('constructor', () => {
    it('creates instance with config', () => {
      expect(client).toBeInstanceOf(OpenAICompatibleClient);
    });
  });

  describe('generateCompletion', () => {
    it('returns completion string on success', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          choices: [{ message: { content: 'test response' } }]
        }
      });

      const result = await client.generateCompletion('test prompt');

      expect(result).toBe('test response');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://test.com/chat/completions',
        expect.objectContaining({
          model: 'test-model',
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'test prompt' })
          ])
        }),
        expect.any(Object)
      );
    });

    it('throws on API error', async () => {
      mockedAxios.post.mockRejectedValue(new Error('API error'));

      await expect(client.generateCompletion('test')).rejects.toThrow('API error');
    });
  });

  describe('chatCompletion', () => {
    it('returns completion string on success', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          choices: [{ message: { content: 'chat response' } }]
        }
      });

      const result = await client.chatCompletion([{ role: 'user', content: 'hello' }]);

      expect(result).toBe('chat response');
    });

    it('throws on API error', async () => {
      mockedAxios.post.mockRejectedValue(new Error('API error'));

      await expect(client.chatCompletion([{ role: 'user', content: 'hello' }])).rejects.toThrow('API error');
    });
  });

  describe('testConnection', () => {
    it('returns true on success', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          choices: [{ message: { content: 'ok' } }]
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
});

describe('createDashScopeClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates client with correct config', () => {
    const client = createDashScopeClient('test-key', 'llama3', 'http://test.com');

    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });
});

describe('testDashScope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns success with latency on valid key', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        choices: [{ message: { content: 'ok' } }]
      }
    });

    const result = await testDashScope('valid-key');

    expect(result.success).toBe(true);
    expect(typeof result.latency).toBe('number');
    expect(result.latency).toBeGreaterThanOrEqual(0);
  });

  it('returns failure on invalid key', async () => {
    mockedAxios.post.mockRejectedValue(new Error('Invalid API key'));

    const result = await testDashScope('invalid-key');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid API key');
  });
});
