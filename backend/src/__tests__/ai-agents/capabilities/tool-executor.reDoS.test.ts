/**
 * Regression tests for the ReDoS hardening of `check_pattern` (R6 V2.4).
 *
 * These tests exercise the `ToolExecutor` end-to-end via its public
 * `execute` entry point, focusing on the `check_pattern` tool that
 * previously accepted a user-controlled regex string.
 */

import { ToolExecutor } from '../../../ai-agents/capabilities/tool-executor';

describe('ToolExecutor / check_pattern ReDoS defense', () => {
  let executor: ToolExecutor;

  beforeEach(() => {
    executor = new ToolExecutor();
  });

  it('rejects catastrophic backtracking patterns from the caller', async () => {
    const result = await executor.execute({
      requestId: 'req-1',
      toolName: 'check_pattern',
      parameters: {
        content: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!',
        patterns: ['(a+)+$']
      }
    } as any);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unsafe regex pattern rejected/i);
    expect(result.error).toMatch(/backtracking|nested quantifier/i);
  });

  it('rejects patterns that exceed the length ceiling', async () => {
    const longPattern = 'a'.repeat(600);
    const result = await executor.execute({
      requestId: 'req-2',
      toolName: 'check_pattern',
      parameters: {
        content: 'hello world',
        patterns: [longPattern]
      }
    } as any);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unsafe regex pattern rejected/i);
    expect(result.error).toMatch(/exceeds/i);
  });

  it('rejects deeply nested group patterns', async () => {
    const result = await executor.execute({
      requestId: 'req-3',
      toolName: 'check_pattern',
      parameters: {
        content: '(((a)))',
        patterns: ['((((a))))']
      }
    } as any);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nesting depth/i);
  });

  it('still matches legitimate user-supplied patterns', async () => {
    const result = await executor.execute({
      requestId: 'req-4',
      toolName: 'check_pattern',
      parameters: {
        content: '<script>alert(1)</script>',
        patterns: ['<script[^>]*>']
      }
    } as any);

    expect(result.success).toBe(true);
    expect(result.output.matchesFound).toBeGreaterThan(0);
    // SECURITY FIX (V12.10): the match string is XSS-escaped before
    // being returned to the agent, so the literal `<script` markup
    // is now visible as `&lt;script`. The regex still matched, the
    // unsafe bytes are still scrubbed from the response.
    expect(result.output.matches[0].match).toContain('&lt;script');
  });

  it('falls back to built-in patterns when none are supplied', async () => {
    const result = await executor.execute({
      requestId: 'req-5',
      toolName: 'check_pattern',
      parameters: {
        content: "' OR 1=1 --"
      }
    } as any);

    expect(result.success).toBe(true);
    expect(result.output.matchesFound).toBeGreaterThan(0);
  });

  it('caps the number of matches so a single pattern cannot DoS the response', async () => {
    // Build a long string of repeating 'a' characters; the default
    // pattern `/[;&|`$]/` will never match but the safe-by-default
    // defaultPatterns path also enforces the per-pattern match cap.
    const content = 'a'.repeat(5000);
    const result = await executor.execute({
      requestId: 'req-6',
      toolName: 'check_pattern',
      parameters: { content, patterns: ['a'] }
    } as any);

    expect(result.success).toBe(true);
    // Total accumulated matches across all patterns must be bounded.
    // The `matches` field is itself capped at 20 in the response.
    expect(result.output.matches.length).toBeLessThanOrEqual(20);
  });

  // Wave 8 F18 — V11.19: back-reference-with-quantifier ReDoS
  // The previous cooperative `setTimeout` could not interrupt
  // a blocking `regex.exec`. Combined with the V11.6 safe-regex
  // false negative, a `(.+)\1+` pattern against long input could
  // hang the event loop indefinitely. The fix has two parts:
  //  1. safe-regex now flags back-reference-with-quantifier.
  //  2. tool-executor spawns a worker_threads worker so the
  //     engine can never block the main loop.
  // This test asserts the request is rejected well within the
  // 1-second budget even with a 100k-char content body.
  it('rejects V11.19 back-reference-with-quantifier pattern within 1s even with long content', async () => {
    const content = 'a'.repeat(100000);
    const start = Date.now();
    const result = await executor.execute({
      requestId: 'req-v11-19',
      toolName: 'check_pattern',
      parameters: {
        content,
        patterns: ['(.+)\\1+']
      }
    } as any);
    const elapsed = Date.now() - start;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unsafe regex pattern rejected/i);
    // Static check fires immediately; the request must come back
    // in well under 1s even on a busy CI box.
    expect(elapsed).toBeLessThan(1000);
  });

  it('rejects content larger than the worker hard cap (1MB)', async () => {
    const content = 'a'.repeat(1024 * 1024 + 1);
    const result = await executor.execute({
      requestId: 'req-size',
      toolName: 'check_pattern',
      parameters: { content }
    } as any);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exceeds.*byte limit/i);
  });

  it('runs benign patterns inside the worker without blocking (smoke test)', async () => {
    const content = 'hello <script>alert(1)</script> world ' + 'safe '.repeat(500);
    const result = await executor.execute({
      requestId: 'req-worker-ok',
      toolName: 'check_pattern',
      parameters: {
        content,
        patterns: ['<script[^>]*>']
      }
    } as any);

    expect(result.success).toBe(true);
    expect(result.output.matchesFound).toBeGreaterThan(0);
  });
});
