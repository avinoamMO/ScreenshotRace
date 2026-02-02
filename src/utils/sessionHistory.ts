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
const MAX_SESSIONS = 20;

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

  // Add new session at the beginning
  history.unshift(session);

  // Keep only the last MAX_SESSIONS
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
  avgTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  successRate: number;
  totalRuns: number;
  avgSizeKb: number;
}

export function calculateProviderStats(history: SessionSummary[]): ProviderStats[] {
  const byProvider = new Map<string, SessionResult[]>();

  for (const session of history) {
    for (const result of session.results) {
      const results = byProvider.get(result.provider) || [];
      results.push(result);
      byProvider.set(result.provider, results);
    }
  }

  const stats: ProviderStats[] = [];

  byProvider.forEach((results, provider) => {
    const successful = results.filter(r => r.success);
    const times = successful.map(r => r.timeMs);
    const sizes = successful.filter(r => r.imageSize).map(r => r.imageSize!);

    stats.push({
      provider,
      avgTimeMs: times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0,
      minTimeMs: times.length > 0 ? Math.min(...times) : 0,
      maxTimeMs: times.length > 0 ? Math.max(...times) : 0,
      successRate: results.length > 0 ? (successful.length / results.length) * 100 : 0,
      totalRuns: results.length,
      avgSizeKb: sizes.length > 0 ? (sizes.reduce((a, b) => a + b, 0) / sizes.length) / 1024 : 0,
    });
  });

  return stats.sort((a, b) => a.avgTimeMs - b.avgTimeMs);
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

      // Calculate average time per provider for this session
      const byProvider = new Map<string, number[]>();
      for (const result of session.results) {
        if (result.success) {
          const times = byProvider.get(result.provider) || [];
          times.push(result.timeMs);
          byProvider.set(result.provider, times);
        }
      }

      byProvider.forEach((times, provider) => {
        point[provider] = times.reduce((a, b) => a + b, 0) / times.length;
      });

      return point;
    });
}
