import { DetectionError } from '../detection-errors';
import type { DetectionInput } from '../detection-contract';
import { OllamaDetectionProvider } from '../providers/ollama-detection.provider';

const BASE_OPTIONS = {
  baseUrl: 'http://127.0.0.1:11434',
  model: 'aetherargus-detector'
};

const CONTEXT = {
  requestId: 'req-1',
  systemPrompt: 'SYS',
  timeoutMs: 100,
  numCtx: 2048,
  maxResponseBytes: 4096
};

const INPUT: DetectionInput = {
  method: 'GET',
  path: '/x',
  query: '',
  headers: {},
  body: '',
  sourceContext: { requestsLastMinute: 0, distinctPathsLastMinute: 0, recentFailureCount: 0 },
  ruleSignals: []
};

function makeFetchResponse(init: {
  ok?: boolean;
  status?: number;
  body?: string;
  hang?: boolean;
}): typeof fetch {
  return (async (_url: any, options: any) => {
    if (init.hang) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 10_000);
        options?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          const err: any = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
    return {
      ok: init.ok !== false,
      status: init.status ?? 200,
      text: async () => init.body ?? ''
    } as any;
  }) as typeof fetch;
}

function chatBody(content: string): string {
  return JSON.stringify({ model: 'aetherargus-detector', message: { role: 'assistant', content } });
}

describe('OllamaDetectionProvider', () => {
  it('posts to /api/chat with temperature=0, no sampling, and returns content', async () => {
    const requests: any[] = [];
    const fetchImpl = (async (url: any, options: any) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => chatBody('{"verdict":"unknown","confidence":0.1,"attackFamily":"other","severity":"low","reasoning":"x","evidence":[],"recommendedAction":"monitor"}')
      } as any;
    }) as typeof fetch;

    const provider = new OllamaDetectionProvider({ ...BASE_OPTIONS, fetchImpl });
    const response = await provider.detect(INPUT, CONTEXT);

    expect(requests).toHaveLength(1);
    expect(String(requests[0].url)).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(requests[0].options.body);
    expect(body.stream).toBe(false);
    expect(body.options.temperature).toBe(0);
    expect(body.options.num_ctx).toBe(2048);
    expect(body.options.seed).toBe(0);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toBe('SYS');
    expect(body.messages[1].role).toBe('user');
    expect(response.rawOutput).toContain('"verdict":"unknown"');
  });

  it('maps non-200 to provider_http_error and retries at most once', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return { ok: false, status: 500, text: async () => 'boom' } as any;
    }) as typeof fetch;

    const provider = new OllamaDetectionProvider({ ...BASE_OPTIONS, fetchImpl });
    await expect(provider.detect(INPUT, CONTEXT)).rejects.toMatchObject({
      code: 'provider_http_error'
    });
    expect(calls).toBe(2); // one initial + one safety retry
  });

  it('does not retry non-transient output-shape failures', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => chatBody('') } as any;
    }) as typeof fetch;

    const provider = new OllamaDetectionProvider({ ...BASE_OPTIONS, fetchImpl });
    await expect(provider.detect(INPUT, CONTEXT)).rejects.toMatchObject({
      code: 'provider_response_empty'
    });
    expect(calls).toBe(1);
  });

  it('rejects responses larger than maxResponseBytes', async () => {
    const big = 'x'.repeat(10_000);
    const fetchImpl = makeFetchResponse({ body: chatBody(big) });
    const provider = new OllamaDetectionProvider({ ...BASE_OPTIONS, fetchImpl });
    await expect(provider.detect(INPUT, { ...CONTEXT, maxResponseBytes: 100 })).rejects.toMatchObject({
      code: 'provider_response_too_large'
    });
  });

  it('rejects non-JSON envelope as provider_unavailable', async () => {
    const fetchImpl = makeFetchResponse({ body: '<html>not json</html>' });
    const provider = new OllamaDetectionProvider({ ...BASE_OPTIONS, fetchImpl });
    await expect(provider.detect(INPUT, CONTEXT)).rejects.toMatchObject({
      code: 'provider_unavailable'
    });
  });

  it('maps ollama-level error field to provider_http_error', async () => {
    const fetchImpl = makeFetchResponse({ body: JSON.stringify({ error: 'model not found' }) });
    const provider = new OllamaDetectionProvider({ ...BASE_OPTIONS, fetchImpl });
    await expect(provider.detect(INPUT, CONTEXT)).rejects.toMatchObject({
      code: 'provider_http_error'
    });
  });

  it('maps request timeout to provider_timeout without a retry', async () => {
    let calls = 0;
    const fetchImpl = (async (_url: any, options: any) => {
      calls += 1;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5_000);
        options?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          const err: any = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
      return { ok: true, status: 200, text: async () => '' } as any;
    }) as typeof fetch;

    const provider = new OllamaDetectionProvider({ ...BASE_OPTIONS, fetchImpl });
    await expect(provider.detect(INPUT, { ...CONTEXT, timeoutMs: 50 })).rejects.toMatchObject({
      code: 'provider_timeout'
    });
    expect(calls).toBe(1); // aborts never retry
  });

  it('honours the outer cancellation signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = makeFetchResponse({ body: chatBody('{}') });
    const provider = new OllamaDetectionProvider({ ...BASE_OPTIONS, fetchImpl });
    await expect(
      provider.detect(INPUT, { ...CONTEXT, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('health check hits /api/tags only (no inference)', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: any) => {
      urls.push(String(url));
      return { ok: true, status: 200, text: async () => '{"models":[]}' } as any;
    }) as typeof fetch;
    const provider = new OllamaDetectionProvider({ ...BASE_OPTIONS, fetchImpl });
    const health = await provider.healthCheck();
    expect(health.healthy).toBe(true);
    expect(urls).toEqual(['http://127.0.0.1:11434/api/tags']);
  });

  it('health check reports unreachable as unhealthy without throwing', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const provider = new OllamaDetectionProvider({ ...BASE_OPTIONS, fetchImpl });
    const health = await provider.healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.errorCode).toBe('provider_unavailable');
  });

  it('wraps unexpected errors into DetectionError', async () => {
    const fetchImpl = (async () => {
      throw new Error('socket hangup');
    }) as typeof fetch;
    const provider = new OllamaDetectionProvider({ ...BASE_OPTIONS, fetchImpl });
    await expect(provider.detect(INPUT, CONTEXT)).rejects.toBeInstanceOf(DetectionError);
  });
});
