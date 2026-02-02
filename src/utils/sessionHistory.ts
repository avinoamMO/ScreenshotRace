export interface SessionResult {
  timestamp: number;
  url: string;
  provider: string;
  timeMs: number;
  success: boolean;
  imageSize?: number;
}

export interface SessionSummary {
  id: string;
  timestamp: number;
  urlCount: number;
  providerCount: number;
  results: SessionResult[];
}

const STORAGE_KEY = 'screenshot-race-history';
const MAX_SESSIONS = 50;

export function loadSessionHistory(): SessionSummary[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    return JSON.parse(data) as SessionSummary[];
  } catch {
    return [];
  }
}

export function saveSession(results: SessionResult[]): SessionSummary {
  const history = loadSessionHistory();

  const session: SessionSummary = {
    id: `session-${Date.now()}`,
    timestamp: Date.now(),
    urlCount: new Set(results.map(r => r.url)).size,
    providerCount: new Set(results.map(r => r.provider)).size,
    results,
  };

  history.unshift(session);
  const trimmed = history.slice(0, MAX_SESSIONS);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.error('Failed to save session history:', e);
  }

  return session;
}

export function clearSessionHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export interface ProviderStats {
  provider: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  successRate: number;
  // Timing stats - ONLY from successful runs
  avgTimeMs: number;
  medianTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  p95TimeMs: number;
  // Size stats
  avgSizeKb: number;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export function calculateProviderStats(history: SessionSummary[]): ProviderStats[] {
  // Group all results by provider
  const byProvider = new Map<string, SessionResult[]>();

  for (const session of history) {
    for (const result of session.results) {
      const results = byProvider.get(result.provider) || [];
      results.push(result);
      byProvider.set(result.provider, results);
    }
  }

  const stats: ProviderStats[] = [];

  byProvider.forEach((allResults, provider) => {
    // Separate successful and failed
    const successful = allResults.filter(r => r.success);
    const failed = allResults.filter(r => !r.success);

    // Timing: ONLY from successful runs (failed runs just measure time-to-error)
    const times = successful.map(r => r.timeMs);
    const sizes = successful.filter(r => r.imageSize).map(r => r.imageSize!);

    stats.push({
      provider,
      totalRuns: allResults.length,
      successfulRuns: successful.length,
      failedRuns: failed.length,
      successRate: allResults.length > 0 ? (successful.length / allResults.length) * 100 : 0,
      // Timing stats
      avgTimeMs: times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0,
      medianTimeMs: median(times),
      minTimeMs: times.length > 0 ? Math.min(...times) : 0,
      maxTimeMs: times.length > 0 ? Math.max(...times) : 0,
      p95TimeMs: percentile(times, 95),
      // Size
      avgSizeKb: sizes.length > 0 ? (sizes.reduce((a, b) => a + b, 0) / sizes.length) / 1024 : 0,
    });
  });

  // Sort by median time (more representative than average)
  return stats.sort((a, b) => a.medianTimeMs - b.medianTimeMs);
}

export interface TimeSeriesPoint {
  timestamp: number;
  [provider: string]: number;
}

export function getTimeSeriesData(history: SessionSummary[]): TimeSeriesPoint[] {
  return history
    .slice()
    .reverse()
    .map(session => {
      const point: TimeSeriesPoint = { timestamp: session.timestamp };

      // Calculate median time per provider for this session (only successful)
      const byProvider = new Map<string, number[]>();
      for (const result of session.results) {
        if (result.success) {
          const times = byProvider.get(result.provider) || [];
          times.push(result.timeMs);
          byProvider.set(result.provider, times);
        }
      }

      byProvider.forEach((times, provider) => {
        // Use median for the time series - more stable than average
        point[provider] = median(times);
      });

      return point;
    });
}
