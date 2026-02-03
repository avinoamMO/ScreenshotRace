import type { AIQualityResult } from './aiQuality';

export interface ScoredAttempt {
  provider: string;
  screenshot: string; // base64
  size: number;
  timeMs: number;
  aiResult: AIQualityResult | null;
  issue: string | null;
}

/**
 * Composite scoring for selecting the best screenshot attempt.
 * Higher score = better result.
 *
 * Scoring breakdown:
 * - AI valid + no paywall + no error = 1000 pts (dominant factor)
 * - Image size bonus: up to 10 pts (larger = more content)
 * - Speed bonus: up to 5 pts (faster is better)
 * - Puppeteer preference: 2 pts (cheapest provider)
 */
export function computeScore(attempt: ScoredAttempt): number {
  let score = 0;

  const ai = attempt.aiResult;

  // AI validation is the dominant factor
  if (ai) {
    if (ai.isValid && !ai.hasPaywall && !ai.hasError) {
      score += 1000;
    } else {
      // Penalize bad AI results heavily
      if (ai.hasError) score -= 500;
      if (ai.hasPaywall) score -= 500;
      if (!ai.isValid) score -= 300;
    }
  }

  // Image size bonus (up to 10 pts) — larger images tend to have more content
  if (attempt.size > 0) {
    score += Math.min(attempt.size / 100_000, 10);
  }

  // Speed bonus (up to 5 pts) — faster is slightly better
  if (attempt.timeMs > 0) {
    score += Math.min(5, 5000 / attempt.timeMs);
  }

  // Puppeteer preference bonus — it's the cheapest provider (no external API cost)
  if (attempt.provider === 'puppeteer' || attempt.provider === 'puppeteer+actions') {
    score += 2;
  }

  return score;
}

/**
 * Select the best attempt from a list based on composite scoring.
 * Returns the attempt with the highest score.
 */
export function selectBest(attempts: ScoredAttempt[]): ScoredAttempt | null {
  if (attempts.length === 0) return null;

  let best = attempts[0];
  let bestScore = computeScore(best);

  for (let i = 1; i < attempts.length; i++) {
    const score = computeScore(attempts[i]);
    if (score > bestScore) {
      bestScore = score;
      best = attempts[i];
    }
  }

  return best;
}

/**
 * Check if the best attempt so far is still considered bad
 * (i.e., fallback providers should be tried).
 */
export function isBestStillBad(attempts: ScoredAttempt[]): boolean {
  const best = selectBest(attempts);
  if (!best) return true;

  const ai = best.aiResult;
  // No AI result → we don't know, treat as potentially bad
  if (!ai) return true;
  // AI says it's bad
  if (ai.hasError || ai.hasPaywall || !ai.isValid) return true;

  return false;
}
