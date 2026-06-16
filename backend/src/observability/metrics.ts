/**
 * Minimal Prometheus-style metrics registry
 *
 * Self-contained, zero-dependency metrics registry modeled on the
 * Prometheus exposition format (HELP / TYPE / samples).  This is the
 * sprint-4 OTel/metrics skeleton for the AetherGuard control plane.
 *
 * NOTE: This is intentionally lightweight.  We do not depend on the
 * OTel SDK or any third-party metrics library.  The implementation
 * stays compatible with the standard text exposition format so a real
 * Prometheus scraper (or any scraper that speaks the 0.0.4 text
 * format) can ingest it without modification.
 */

import logger from '../utils/logger';

export type MetricLabels = Record<string, string>;

export interface HistogramBucketState {
  count: number;
  cumulative: number;
}

export interface HistogramState {
  count: number;
  sum: number;
  buckets: Map<number, HistogramBucketState>;
}

interface CounterEntry {
  name: string;
  help: string;
  labels: MetricLabels;
  value: number;
}

interface HistogramEntry {
  name: string;
  help: string;
  labels: MetricLabels;
  state: HistogramState;
}

const DEFAULT_HISTOGRAM_BUCKETS_MS: readonly number[] = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000
];

const HELP_TEXT: Record<string, string> = {
  http_requests_total: 'Total number of HTTP requests processed by the control plane.',
  http_request_duration_ms: 'HTTP request duration in milliseconds.'
};

function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
}

function labelsKey(labels?: MetricLabels): string {
  if (!labels) {
    return '';
  }
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) {
    return '';
  }
  return keys
    .map((key) => `${key}=${escapeLabelValue(String(labels[key] ?? ''))}`)
    .join('|');
}

function serializeLabels(labels?: MetricLabels): string {
  if (!labels) {
    return '';
  }
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) {
    return '';
  }
  return keys
    .map((key) => `${key}="${escapeLabelValue(String(labels[key] ?? ''))}"`)
    .join(',');
}

export class Metrics {
  private readonly counters: Map<string, CounterEntry> = new Map();
  private readonly histograms: Map<string, HistogramEntry> = new Map();
  private readonly histogramBuckets: readonly number[] = DEFAULT_HISTOGRAM_BUCKETS_MS;

  /**
   * Increment a counter by `value` (default 1).  Counters are uniquely
   * identified by metric name + label-set.  Negative increments are
   * ignored to keep monotonicity guarantees intact.
   */
  incCounter(name: string, labels: MetricLabels = {}, value = 1): void {
    try {
      if (!Number.isFinite(value) || value < 0) {
        return;
      }
      const key = `${name}|${labelsKey(labels)}`;
      const existing = this.counters.get(key);
      if (existing) {
        existing.value += value;
        return;
      }
      this.counters.set(key, {
        name,
        help: HELP_TEXT[name] || `Counter metric ${name}.`,
        labels,
        value
      });
    } catch (error: any) {
      logger.warn('metrics.incCounter failed', {
        name,
        error: error?.message
      });
    }
  }

  /**
   * Record a single observation into a histogram.  Buckets are
   * cumulative (Prometheus convention): bucket `le=100` counts every
   * observation <= 100.
   */
  observeHistogram(name: string, value: number, labels: MetricLabels = {}): void {
    try {
      if (!Number.isFinite(value)) {
        return;
      }
      const key = `${name}|${labelsKey(labels)}`;
      const existing = this.histograms.get(key);
      if (existing) {
        this.recordObservation(existing.state, value);
        return;
      }
      const state: HistogramState = {
        count: 0,
        sum: 0,
        buckets: new Map(this.histogramBuckets.map((le) => [le, { count: 0, cumulative: 0 }]))
      };
      this.histograms.set(key, {
        name,
        help: HELP_TEXT[name] || `Histogram metric ${name}.`,
        labels,
        state
      });
      this.recordObservation(state, value);
    } catch (error: any) {
      logger.warn('metrics.observeHistogram failed', {
        name,
        error: error?.message
      });
    }
  }

  private recordObservation(state: HistogramState, value: number): void {
    state.count += 1;
    state.sum += value;
    for (const le of this.histogramBuckets) {
      const bucket = state.buckets.get(le);
      if (!bucket) {
        continue;
      }
      bucket.count += 1;
      if (value <= le) {
        bucket.cumulative += 1;
      }
    }
  }

  /**
   * Reset all counters and histograms.  Primarily useful in tests.
   */
  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }

  /**
   * Render the current snapshot in Prometheus text exposition format
   * (version 0.0.4).  Output is grouped by metric name; counters and
   * histograms share the standard `# HELP` / `# TYPE` headers.
   */
  render(): string {
    const lines: string[] = [];
    const groupedCounters = this.groupCounters();
    for (const [name, entries] of groupedCounters.entries()) {
      const help = entries[0]?.help || `Counter metric ${name}.`;
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} counter`);
      for (const entry of entries) {
        const labelStr = serializeLabels(entry.labels);
        if (labelStr.length === 0) {
          lines.push(`${name} ${this.formatNumber(entry.value)}`);
        } else {
          lines.push(`${name}{${labelStr}} ${this.formatNumber(entry.value)}`);
        }
      }
    }

    const groupedHistograms = this.groupHistograms();
    for (const [name, entries] of groupedHistograms.entries()) {
      const help = entries[0]?.help || `Histogram metric ${name}.`;
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const entry of entries) {
        const baseLabelStr = serializeLabels(entry.labels);
        for (const le of this.histogramBuckets) {
          const bucket = entry.state.buckets.get(le);
          if (!bucket) {
            continue;
          }
          const merged = this.mergeLabels(entry.labels, { le: String(le) });
          const labelStr = serializeLabels(merged);
          lines.push(`${name}_bucket{${labelStr}} ${this.formatNumber(bucket.cumulative)}`);
        }
        const infMerged = this.mergeLabels(entry.labels, { le: '+Inf' });
        const infLabelStr = serializeLabels(infMerged);
        lines.push(`${name}_bucket{${infLabelStr}} ${this.formatNumber(entry.state.count)}`);
        const sumLabelStr = baseLabelStr;
        if (sumLabelStr.length === 0) {
          lines.push(`${name}_sum ${this.formatNumber(entry.state.sum)}`);
          lines.push(`${name}_count ${this.formatNumber(entry.state.count)}`);
        } else {
          lines.push(`${name}_sum{${sumLabelStr}} ${this.formatNumber(entry.state.sum)}`);
          lines.push(`${name}_count{${sumLabelStr}} ${this.formatNumber(entry.state.count)}`);
        }
      }
    }

    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  }

  private groupCounters(): Map<string, CounterEntry[]> {
    const grouped = new Map<string, CounterEntry[]>();
    for (const entry of this.counters.values()) {
      const list = grouped.get(entry.name) || [];
      list.push(entry);
      grouped.set(entry.name, list);
    }
    return grouped;
  }

  private groupHistograms(): Map<string, HistogramEntry[]> {
    const grouped = new Map<string, HistogramEntry[]>();
    for (const entry of this.histograms.values()) {
      const list = grouped.get(entry.name) || [];
      list.push(entry);
      grouped.set(entry.name, list);
    }
    return grouped;
  }

  private mergeLabels(base: MetricLabels, extra: MetricLabels): MetricLabels {
    return { ...base, ...extra };
  }

  private formatNumber(value: number): string {
    if (!Number.isFinite(value)) {
      return '0';
    }
    if (Number.isInteger(value)) {
      return String(value);
    }
    return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  }
}

const metricsInstance = new Metrics();
export default metricsInstance;
