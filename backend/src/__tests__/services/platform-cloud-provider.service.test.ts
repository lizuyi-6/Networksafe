/**
 * Platform Cloud Provider Service Tests
 *
 * Tests for AI model invocation via platform cloud API
 */

describe('Platform Cloud Provider Service', () => {
  let mockPost: jest.Mock;
  let serviceModule: any;

  beforeAll(() => {
    mockPost = jest.fn();
    jest.resetModules();
    jest.doMock('axios', () => ({ post: mockPost }));
    jest.doMock('../../utils/model-access', () => ({
      PLATFORM_API_CONFIG: {
        providerId: 'test-provider',
        protocol: 'openai-compatible',
        baseURL: 'https://api.example.com/v1',
        apiKey: 'test-api-key',
        timeout: 30000,
        defaultHeaders: { 'x-custom': 'header' }
      },
      buildPlatformCloudUrl: jest.fn(() => 'https://api.example.com/v1/chat/completions'),
      getPlatformChatPath: jest.fn(() => '/v1/chat/completions')
    }));
    serviceModule = require('../../services/platform-cloud-provider.service');
  });

  afterAll(() => {
    jest.resetModules();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PlatformCloudInvocationError', () => {
    it('stores diagnostics in error', () => {
      const diagnostics = {
        provider: 'test-provider',
        protocol: 'openai-compatible' as const,
        upstreamStatus: 401,
        upstreamPath: '/v1/chat/completions',
        requestId: 'req-123',
        baseURL: 'https://api.example.com'
      };
      const error = new serviceModule.PlatformCloudInvocationError(
        'Invalid API key',
        diagnostics,
        { error: 'bad key' }
      );

      expect(error.message).toBe('Invalid API key');
      expect(error.name).toBe('PlatformCloudInvocationError');
      expect(error.diagnostics).toEqual(diagnostics);
      expect(error.responseBody).toEqual({ error: 'bad key' });
    });
  });

  describe('invokePlatformCloudModel (OpenAI-compatible)', () => {
    it('returns content from OpenAI-compatible response', async () => {
      mockPost.mockResolvedValue({
        status: 200,
        data: {
          choices: [{ message: { content: 'Hello from model' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
        },
        headers: {}
      });

      const result = await serviceModule.invokePlatformCloudModel('gpt-4', [
        { role: 'user', content: 'Hello' }
      ]);

      expect(result.content).toBe('Hello from model');
      expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 });
      expect(result.diagnostics.provider).toBe('test-provider');
      expect(result.diagnostics.upstreamStatus).toBe(200);
    });

    it('extracts request ID from response payload', async () => {
      mockPost.mockResolvedValue({
        status: 200,
        data: { choices: [{ message: { content: 'ok' } }], request_id: 'dashscope-req-001' },
        headers: {}
      });

      const result = await serviceModule.invokePlatformCloudModel('gpt-4', [
        { role: 'user', content: 'Hi' }
      ]);

      expect(result.diagnostics.requestId).toBe('dashscope-req-001');
    });

    it('handles empty choices gracefully', async () => {
      mockPost.mockResolvedValue({
        status: 200,
        data: { choices: [] },
        headers: {}
      });

      const result = await serviceModule.invokePlatformCloudModel('gpt-4', [
        { role: 'user', content: 'Hi' }
      ]);

      expect(result.content).toBe('');
    });

    it('throws PlatformCloudInvocationError on HTTP 401', async () => {
      mockPost.mockRejectedValue({
        response: {
          status: 401,
          data: { error: { message: 'Invalid API key' } },
          headers: {}
        },
        message: 'Request failed with status 401'
      });

      await expect(
        serviceModule.invokePlatformCloudModel('gpt-4', [{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow(serviceModule.PlatformCloudInvocationError);

      try {
        await serviceModule.invokePlatformCloudModel('gpt-4', [
          { role: 'user', content: 'Hello' }
        ]);
      } catch (err: any) {
        expect(err.diagnostics.upstreamStatus).toBe(401);
      }
    });

    it('throws PlatformCloudInvocationError on HTTP 429', async () => {
      mockPost.mockRejectedValue({
        response: {
          status: 429,
          data: { error: { message: 'Rate limit exceeded' } },
          headers: {}
        },
        message: 'Request failed with status 429'
      });

      await expect(
        serviceModule.invokePlatformCloudModel('gpt-4', [{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow(serviceModule.PlatformCloudInvocationError);

      try {
        await serviceModule.invokePlatformCloudModel('gpt-4', [
          { role: 'user', content: 'Hello' }
        ]);
      } catch (err: any) {
        expect(err.diagnostics.upstreamStatus).toBe(429);
        expect(err.message).toContain('Rate limit exceeded');
      }
    });

    it('throws on network error', async () => {
      mockPost.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        serviceModule.invokePlatformCloudModel('gpt-4', [{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow('ECONNREFUSED');
    });

    it('includes latency in result', async () => {
      mockPost.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  status: 200,
                  data: { choices: [{ message: { content: 'response' } }] },
                  headers: {}
                }),
              50
            )
          )
      );

      const result = await serviceModule.invokePlatformCloudModel('gpt-4', [
        { role: 'user', content: 'Hi' }
      ]);

      // setTimeout(50) + Date.now() truncation can measure as 49ms; allow jitter.
      expect(result.latency).toBeGreaterThanOrEqual(45);
    });
  });

  describe('PlatformCloudClient', () => {
    it('calls invokePlatformCloudModel with correct model', async () => {
      mockPost.mockResolvedValue({
        status: 200,
        data: { choices: [{ message: { content: 'test response' } }] },
        headers: {}
      });

      const client = new serviceModule.PlatformCloudClient('claude-3-sonnet', 2000, 0.3);
      const result = await client.generateCompletion('What is 2+2?');

      expect(result).toBe('test response');
      expect(mockPost).toHaveBeenCalledWith(
        'https://api.example.com/v1/chat/completions',
        expect.objectContaining({ model: 'claude-3-sonnet' }),
        expect.any(Object)
      );
    });

    it('uses model override when provided', async () => {
      mockPost.mockResolvedValue({
        status: 200,
        data: { choices: [{ message: { content: 'override response' } }] },
        headers: {}
      });

      const client = new serviceModule.PlatformCloudClient('default-model');
      const result = await client.generateCompletion('Hello', 'override-model');

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ model: 'override-model' }),
        expect.any(Object)
      );
      expect(result).toBe('override response');
    });
  });
});
