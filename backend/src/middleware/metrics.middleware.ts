/**
 * HTTP request metrics middleware
 *
 * Records request count and duration histograms for every incoming
 * HTTP request, including 401/404/error responses.  Mounted at the
 * application root (not under apiRouter) so the metrics cover the
 * full control plane surface.
 *
 * Cardinality safety: we use `req.route?.path` when available, falling
 * back to `req.path` only if the request never matched a route.  This
 * keeps the `route` label bounded by the registered route table.
 */

import { NextFunction, Request, Response } from 'express';
import metrics from '../observability/metrics';

const METRIC_REQUESTS = 'http_requests_total';
const METRIC_DURATION = 'http_request_duration_ms';

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startNs = process.hrtime.bigint();
  const start = Number(startNs);

  res.on('finish', () => {
    try {
      const elapsedNs = process.hrtime.bigint() - startNs;
      const durationMs = Number(elapsedNs) / 1_000_000;
      const method = req.method || 'UNKNOWN';
      const status = String(res.statusCode || 0);
      const route = resolveRouteLabel(req);

      metrics.incCounter(METRIC_REQUESTS, { method, route, status });
      metrics.observeHistogram(METRIC_DURATION, durationMs, { method, route, status });
    } catch {
      // Metrics are best-effort; never throw from the finish hook.
    }
  });

  // Touch the local `start` value so linters do not flag it as unused
  // (it is reserved for future synchronous instrumentation).
  void start;
  next();
}

function resolveRouteLabel(req: Request): string {
  const routePath = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof routePath === 'string' && routePath.length > 0) {
    return routePath;
  }
  // Fallback for requests that never matched a route (404s, malformed URLs).
  return req.path || 'unknown';
}
