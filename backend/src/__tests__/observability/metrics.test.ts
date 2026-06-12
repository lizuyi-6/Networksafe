/**
 * Metrics registry unit tests
 *
 * Exercises the lightweight Prometheus-style metrics registry
 * (counters + histograms + text-format rendering) and the HTTP
 * request middleware that records request counts/durations.
 */

import express from 'express';
import request from 'supertest';
import { Metrics } from '../../observability/metrics';
import metrics, { default as defaultMetrics } from '../../observability/metrics';
import { metricsMiddleware } from '../../middleware/metrics.middleware';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

const METRIC_LABELS = ['method', 'route', 'status'];
const COUNTER_NAME = 'http_requests_total';
const HISTOGRAM_NAME = 'http_request_duration_ms';

function findLine(output: string, prefix: string): string | null {
  const lines = output.split('\n');
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      return line;
    }
  }
  return null;
}

describe('Metrics registry', () => {
  let m: Metrics;

  beforeEach(() => {
    m = new Metrics();
  });

  it('incCounter increments the rendered counter value', () => {
    m.incCounter('demo_counter_total');
    m.incCounter('demo_counter_total', undefined, 4);
    const output = m.render();
    expect(output).toContain('# HELP demo_counter_total');
    expect(output).toContain('# TYPE demo_counter_total counter');
    const line = findLine(output, 'demo_counter_total');
    expect(line).not.toBeNull();
    expect(line).toBe('demo_counter_total 5');
  });

  it('observeHistogram accumulates sum, count, and bucket counters', () => {
    m.observeHistogram('demo_histogram_ms', 12);
    m.observeHistogram('demo_histogram_ms', 80);
    m.observeHistogram('demo_histogram_ms', 600);

    const output = m.render();
    expect(output).toContain('# TYPE demo_histogram_ms histogram');
    expect(findLine(output, 'demo_histogram_ms_count')).toBe('demo_histogram_ms_count 3');
    expect(findLine(output, 'demo_histogram_ms_sum')).toBe('demo_histogram_ms_sum 692');

    // 12ms falls into every bucket with le >= 12 (5 excluded)
    expect(findLine(output, 'demo_histogram_ms_bucket{le="5"}')).toBe('demo_histogram_ms_bucket{le="5"} 0');
    expect(findLine(output, 'demo_histogram_ms_bucket{le="10"}')).toBe('demo_histogram_ms_bucket{le="10"} 0');
    expect(findLine(output, 'demo_histogram_ms_bucket{le="25"}')).toBe('demo_histogram_ms_bucket{le="25"} 1');
    expect(findLine(output, 'demo_histogram_ms_bucket{le="100"}')).toBe('demo_histogram_ms_bucket{le="100"} 2');
    expect(findLine(output, 'demo_histogram_ms_bucket{le="1000"}')).toBe('demo_histogram_ms_bucket{le="1000"} 3');
    expect(findLine(output, 'demo_histogram_ms_bucket{le="+Inf"}')).toBe('demo_histogram_ms_bucket{le="+Inf"} 3');
  });

  it('groups multi-label counters by label set in rendered output', () => {
    m.incCounter('demo_label_counter_total', { route: '/a', method: 'GET' });
    m.incCounter('demo_label_counter_total', { route: '/a', method: 'GET' }, 2);
    m.incCounter('demo_label_counter_total', { route: '/b', method: 'POST' });

    const output = m.render();
    // Labels are emitted in sorted key order: method, route.
    expect(output).toContain('demo_label_counter_total{method="GET",route="/a"} 3');
    expect(output).toContain('demo_label_counter_total{method="POST",route="/b"} 1');
  });

  it('render() output includes HELP and TYPE headers for each metric', () => {
    m.incCounter(COUNTER_NAME, { method: 'GET', route: '/', status: '200' });
    m.observeHistogram(HISTOGRAM_NAME, 42, { method: 'GET', route: '/', status: '200' });

    const output = m.render();
    expect(output).toContain('# HELP http_requests_total');
    expect(output).toContain('# TYPE http_requests_total counter');
    expect(output).toContain('# HELP http_request_duration_ms');
    expect(output).toContain('# TYPE http_request_duration_ms histogram');
  });

  it('metricsMiddleware records a counter and histogram sample on response finish', async () => {
    const app = express();
    app.use(metricsMiddleware);
    app.get('/probe-mw', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    await request(app).get('/probe-mw').expect(200);

    const output = metrics.render();
    // Look for the probe-mw route observations in the (shared) singleton.
    const counterLine = findLine(output, `${COUNTER_NAME}{method="GET",route="/probe-mw",status="200"}`);
    expect(counterLine).not.toBeNull();
    expect(counterLine).toMatch(/^http_requests_total\{method="GET",route="\/probe-mw",status="200"\} \d+$/);
    const countLine = findLine(output, `${HISTOGRAM_NAME}_count{method="GET",route="/probe-mw",status="200"}`);
    expect(countLine).not.toBeNull();
  });

  it('default export is a singleton Metrics instance', () => {
    expect(defaultMetrics).toBe(metrics);
    expect(metrics).toBeInstanceOf(Metrics);
  });
});
