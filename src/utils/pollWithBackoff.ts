export interface BackoffOptions {
  initialIntervalMs?: number;  // Default: 200
  maxIntervalMs?: number;      // Default: 2000
  backoffFactor?: number;      // Default: 1.5
}

export function getNextInterval(
  attempt: number,
  options: BackoffOptions = {}
): number {
  const {
    initialIntervalMs = 200,
    maxIntervalMs = 2000,
    backoffFactor = 1.5,
  } = options;

  const interval = initialIntervalMs * Math.pow(backoffFactor, attempt);
  return Math.min(interval, maxIntervalMs);
}
