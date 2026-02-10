import { describe, it, expect } from 'vitest';
import { computeScore, selectBest, isBestStillBad } from '../scoring';
import type { ScoredAttempt } from '../scoring';
import type { AIQualityResult } from '../aiQuality';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAttempt(overrides: Partial<ScoredAttempt> = {}): ScoredAttempt {
  return {
    provider: 'puppeteer',
    screenshot: 'base64data',
    size: 50000,
    timeMs: 3000,
    aiResult: null,
    issue: null,
    ...overrides,
  };
}

function makeAI(overrides: Partial<AIQualityResult> = {}): AIQualityResult {
  return {
    hasError: false,
    hasPaywall: false,
    isValid: true,
    reason: 'OK',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeScore
// ---------------------------------------------------------------------------

describe('computeScore', () => {
  it('should give ~1000+ points for a valid AI result with no issues', () => {
    const attempt = makeAttempt({ aiResult: makeAI() });
    const score = computeScore(attempt);
    // 1000 (AI valid) + size bonus + speed bonus + puppeteer bonus
    expect(score).toBeGreaterThan(1000);
  });

  it('should penalize error pages with -500', () => {
    const attempt = makeAttempt({
      aiResult: makeAI({ hasError: true, isValid: true }),
    });
    const score = computeScore(attempt);
    // -500 (error) + size bonus + speed bonus + puppeteer bonus
    expect(score).toBeLessThan(0);
  });

  it('should penalize paywall pages with -500', () => {
    const attempt = makeAttempt({
      aiResult: makeAI({ hasPaywall: true, isValid: true }),
    });
    const score = computeScore(attempt);
    expect(score).toBeLessThan(0);
  });

  it('should penalize invalid screenshots with -300', () => {
    const attempt = makeAttempt({
      aiResult: makeAI({ isValid: false }),
    });
    const score = computeScore(attempt);
    expect(score).toBeLessThan(0);
  });

  it('should stack penalties for error + paywall', () => {
    const attempt = makeAttempt({
      aiResult: makeAI({ hasError: true, hasPaywall: true, isValid: false }),
    });
    const score = computeScore(attempt);
    // -500 (error) -500 (paywall) -300 (invalid) + small bonuses
    expect(score).toBeLessThan(-1000);
  });

  it('should give 0 base score when no AI result', () => {
    const attempt = makeAttempt({ aiResult: null });
    const score = computeScore(attempt);
    // Only size + speed + puppeteer bonuses
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(20);
  });

  it('should give size bonus proportional to image size', () => {
    const small = makeAttempt({ aiResult: null, size: 10000 });
    const large = makeAttempt({ aiResult: null, size: 500000 });
    expect(computeScore(large)).toBeGreaterThan(computeScore(small));
  });

  it('should cap size bonus at 10 points', () => {
    const huge = makeAttempt({ aiResult: null, size: 10_000_000 });
    // Score should be size(10) + speed + puppeteer, well under 20
    expect(computeScore(huge)).toBeLessThan(20);
  });

  it('should give speed bonus for faster results', () => {
    const fast = makeAttempt({ aiResult: null, size: 0, timeMs: 500 });
    const slow = makeAttempt({ aiResult: null, size: 0, timeMs: 10000 });
    expect(computeScore(fast)).toBeGreaterThan(computeScore(slow));
  });

  it('should give puppeteer a +2 preference bonus', () => {
    const puppeteer = makeAttempt({ provider: 'puppeteer', aiResult: null, size: 0, timeMs: 0 });
    const browserless = makeAttempt({ provider: 'browserless', aiResult: null, size: 0, timeMs: 0 });
    expect(computeScore(puppeteer) - computeScore(browserless)).toBeCloseTo(2, 1);
  });

  it('should also give puppeteer+actions the preference bonus', () => {
    const remediated = makeAttempt({ provider: 'puppeteer+actions', aiResult: null, size: 0, timeMs: 0 });
    const browserless = makeAttempt({ provider: 'browserless', aiResult: null, size: 0, timeMs: 0 });
    expect(computeScore(remediated) - computeScore(browserless)).toBeCloseTo(2, 1);
  });
});

// ---------------------------------------------------------------------------
// selectBest
// ---------------------------------------------------------------------------

describe('selectBest', () => {
  it('should return null for empty array', () => {
    expect(selectBest([])).toBeNull();
  });

  it('should return the only element for single-item array', () => {
    const attempt = makeAttempt();
    expect(selectBest([attempt])).toBe(attempt);
  });

  it('should select the attempt with valid AI over one without', () => {
    const withAI = makeAttempt({ provider: 'browserless', aiResult: makeAI() });
    const withoutAI = makeAttempt({ provider: 'puppeteer', aiResult: null });
    const best = selectBest([withoutAI, withAI]);
    expect(best?.provider).toBe('browserless');
  });

  it('should select valid result over errored result', () => {
    const valid = makeAttempt({ provider: 'urlbox', aiResult: makeAI() });
    const errored = makeAttempt({
      provider: 'puppeteer',
      aiResult: makeAI({ hasError: true }),
    });
    const best = selectBest([errored, valid]);
    expect(best?.provider).toBe('urlbox');
  });

  it('should prefer puppeteer when AI scores are equal', () => {
    const puppeteer = makeAttempt({
      provider: 'puppeteer',
      aiResult: makeAI(),
      size: 50000,
      timeMs: 3000,
    });
    const browserless = makeAttempt({
      provider: 'browserless',
      aiResult: makeAI(),
      size: 50000,
      timeMs: 3000,
    });
    const best = selectBest([browserless, puppeteer]);
    expect(best?.provider).toBe('puppeteer');
  });
});

// ---------------------------------------------------------------------------
// isBestStillBad
// ---------------------------------------------------------------------------

describe('isBestStillBad', () => {
  it('should return true for empty attempts', () => {
    expect(isBestStillBad([])).toBe(true);
  });

  it('should return true when best has no AI result', () => {
    expect(isBestStillBad([makeAttempt({ aiResult: null })])).toBe(true);
  });

  it('should return true when best has error', () => {
    expect(
      isBestStillBad([makeAttempt({ aiResult: makeAI({ hasError: true }) })]),
    ).toBe(true);
  });

  it('should return true when best has paywall', () => {
    expect(
      isBestStillBad([makeAttempt({ aiResult: makeAI({ hasPaywall: true }) })]),
    ).toBe(true);
  });

  it('should return true when best is invalid', () => {
    expect(
      isBestStillBad([makeAttempt({ aiResult: makeAI({ isValid: false }) })]),
    ).toBe(true);
  });

  it('should return false when best is clean', () => {
    expect(isBestStillBad([makeAttempt({ aiResult: makeAI() })])).toBe(false);
  });

  it('should check the highest-scored attempt, not the first', () => {
    const bad = makeAttempt({ aiResult: makeAI({ hasPaywall: true }) });
    const good = makeAttempt({ provider: 'browserless', aiResult: makeAI() });
    // Good one has higher score, so isBestStillBad should be false
    expect(isBestStillBad([bad, good])).toBe(false);
  });
});
