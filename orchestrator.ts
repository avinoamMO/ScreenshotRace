import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { checkAI, checkAIWithRemediation } from './aiQuality';
import type { AIQualityResult } from './aiQuality';
import { screenshotViaBrowserless, screenshotViaUrlbox, screenshotViaZenrows } from './providers';
import { selectBest, isBestStillBad, computeScore } from './scoring';
import type { ScoredAttempt } from './scoring';

// =============================================================================
// STRUCTURED LOGGING (duplicated here to keep module self-contained)
// =============================================================================

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogContext {
  jobId?: string;
  batchId?: string;
  url?: string;
  provider?: string;
  timeMs?: number;
  error?: string;
  [key: string]: unknown;
}

function log(level: LogLevel, message: string, context: LogContext = {}): void {
  console.log(JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  }));
}

const logger = {
  debug: (msg: string, ctx?: LogContext) => log('DEBUG', msg, ctx),
  info: (msg: string, ctx?: LogContext) => log('INFO', msg, ctx),
  warn: (msg: string, ctx?: LogContext) => log('WARN', msg, ctx),
  error: (msg: string, ctx?: LogContext) => log('ERROR', msg, ctx),
};

// =============================================================================

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const BUCKET_NAME = process.env.RESULTS_BUCKET || 'screenshot-race-results';

// =============================================================================
// Types
// =============================================================================

interface OrchestrationResult {
  jobId: string;
  batchId: string;
  url: string;
  phase: 'preview' | 'optimized';
  success: boolean;
  timedOut?: boolean;
  preview?: {
    provider: string;
    timeMs: number;
    size: number;
  };
  optimized?: {
    provider: string;
    timeMs: number;
    size: number;
    quality: {
      score: number;
      aiVerdict: string;
      noPaywall: boolean;
      noError: boolean;
    };
    retryAttempt?: number;
    retryReason?: string;
    attempts: Array<{
      provider: string;
      score: number;
      issue: string | null;
    }>;
  };
  error?: string;
  completedAt: string;
}

interface PreviewData {
  screenshot: string;
  provider: string;
  timeMs: number;
  size: number;
}

// =============================================================================
// Helpers
// =============================================================================

async function writeImageToS3(jobId: string, imageKey: string, base64Data: string): Promise<void> {
  const buffer = Buffer.from(base64Data, 'base64');
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: `images/${jobId}/${imageKey}`,
    Body: buffer,
    ContentType: 'image/webp',
  }));
}

async function writeResult(jobId: string, result: OrchestrationResult): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: `results/${jobId}.json`,
    Body: JSON.stringify(result),
    ContentType: 'application/json',
  }));
}

async function writeJobStatus(
  jobId: string, batchId: string, url: string,
  status: string, extra: Record<string, unknown> = {}
): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: `jobs/${jobId}.json`,
    Body: JSON.stringify({
      jobId, batchId, url, status,
      ...extra,
      updatedAt: new Date().toISOString(),
    }),
    ContentType: 'application/json',
  }));
}

function issueFromAI(ai: AIQualityResult | null): string | null {
  if (!ai) return 'no-ai-check';
  if (ai.hasPaywall) return 'paywall';
  if (ai.hasError) return 'error';
  if (!ai.isValid) return 'invalid';
  return null;
}

// =============================================================================
// Vendor score persistence
// =============================================================================

async function writeVendorScores(url: string, attempts: ScoredAttempt[]): Promise<void> {
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  for (const attempt of attempts) {
    if (!attempt.aiResult) continue;

    const scoreKey = `scores/${attempt.provider}/${dateStr}.json`;
    const entry = {
      url,
      score: computeScore(attempt),
      aiVerdict: attempt.aiResult.reason,
      noPaywall: !attempt.aiResult.hasPaywall,
      noError: !attempt.aiResult.hasError,
      timestamp: new Date().toISOString(),
    };

    try {
      // Try to read existing file
      let entries: unknown[] = [];
      try {
        const existing = await s3.send(new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: scoreKey,
        }));
        const body = await existing.Body?.transformToString();
        if (body) {
          entries = JSON.parse(body);
        }
      } catch {
        // File doesn't exist yet, start fresh
      }

      entries.push(entry);

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: scoreKey,
        Body: JSON.stringify(entries),
        ContentType: 'application/json',
      }));
    } catch (error) {
      logger.warn('Failed to write vendor score', { provider: attempt.provider, error: String(error) });
    }
  }
}

// =============================================================================
// Final result writer (no base64 in output)
// =============================================================================

async function writeFinalResult(
  jobId: string,
  batchId: string,
  url: string,
  preview: PreviewData | null,
  attempts: ScoredAttempt[],
  best?: ScoredAttempt | null,
): Promise<void> {
  const finalBest = best ?? attempts[0];

  const ai = finalBest?.aiResult;
  const isRetry = finalBest?.provider !== 'puppeteer';

  const result: OrchestrationResult = {
    jobId, batchId, url,
    phase: 'optimized',
    success: true,
    preview: preview ? {
      provider: preview.provider,
      timeMs: preview.timeMs,
      size: preview.size,
    } : undefined,
    optimized: {
      provider: finalBest?.provider ?? 'puppeteer',
      timeMs: finalBest?.timeMs ?? (preview?.timeMs ?? 0),
      size: finalBest?.size ?? (preview?.size ?? 0),
      quality: {
        score: ai && ai.isValid && !ai.hasError && !ai.hasPaywall ? 9 : (ai ? 4 : 5),
        aiVerdict: ai?.reason ?? 'unknown',
        noPaywall: ai ? !ai.hasPaywall : true,
        noError: ai ? !ai.hasError : true,
      },
      retryAttempt: isRetry ? attempts.length - 1 : undefined,
      retryReason: isRetry && finalBest?.issue === null
        ? `Selected via ${finalBest.provider} fallback`
        : undefined,
      attempts: attempts.map(a => ({
        provider: a.provider,
        score: computeScore(a),
        issue: a.issue,
      })),
    },
    completedAt: new Date().toISOString(),
  };

  await writeResult(jobId, result);
}

// =============================================================================
// Core orchestration logic
// =============================================================================

async function runOrchestration(
  url: string,
  jobId: string,
  batchId: string,
  takePuppeteerScreenshot: (url: string, options?: {
    actions?: unknown[];
    extraHeaders?: Record<string, string>;
    preCookies?: Array<{ name: string; value: string; domain: string }>;
  }) => Promise<{ screenshot: string; size: number; timeMs: number }>,
  orchestrationStart: number,
): Promise<void> {
  // Track all attempts
  const attempts: ScoredAttempt[] = [];
  const completedProviders = new Set<string>();
  let bestSoFar: ScoredAttempt | null = null;
  let previewData: PreviewData | null = null;
  let aiEvalCount = 0;

  // =========================================================================
  // Phase 1: Launch ALL providers in parallel
  // =========================================================================
  logger.info('Launching all providers in parallel', { jobId, batchId, url });

  const puppeteerPromise = takePuppeteerScreenshot(url)
    .then(result => ({ ...result, provider: 'puppeteer' as const }))
    .catch(err => {
      logger.warn('Puppeteer failed', { jobId, url, error: String(err) });
      return null;
    });

  const browserlessPromise = process.env.BROWSERLESS_API_KEY
    ? screenshotViaBrowserless(url).catch(err => {
        logger.warn('Browserless failed', { jobId, url, error: String(err) });
        return null;
      })
    : Promise.resolve(null);

  const urlboxPromise = (process.env.URLBOX_API_KEY && process.env.URLBOX_API_SECRET)
    ? screenshotViaUrlbox(url).catch(err => {
        logger.warn('URLBox failed', { jobId, url, error: String(err) });
        return null;
      })
    : Promise.resolve(null);

  const zenrowsPromise = process.env.ZENROWS_API_KEY
    ? screenshotViaZenrows(url).catch(err => {
        logger.warn('ZenRows failed', { jobId, url, error: String(err) });
        return null;
      })
    : Promise.resolve(null);

  // =========================================================================
  // Phase 2: Streaming preview — write as soon as Puppeteer resolves
  // =========================================================================
  const puppeteerResult = await puppeteerPromise;

  if (puppeteerResult) {
    previewData = {
      screenshot: puppeteerResult.screenshot,
      provider: 'puppeteer',
      timeMs: puppeteerResult.timeMs,
      size: puppeteerResult.size,
    };

    // Write preview image to S3 as binary
    await writeImageToS3(jobId, 'preview.webp', puppeteerResult.screenshot);

    // Write preview result JSON (no base64)
    const previewResult: OrchestrationResult = {
      jobId, batchId, url,
      phase: 'preview',
      success: true,
      preview: {
        provider: 'puppeteer',
        timeMs: puppeteerResult.timeMs,
        size: puppeteerResult.size,
      },
      completedAt: new Date().toISOString(),
    };
    await writeResult(jobId, previewResult);
    await writeJobStatus(jobId, batchId, url, 'preview');

    logger.info('Preview written', { jobId, batchId, url, timeMs: puppeteerResult.timeMs });

    completedProviders.add('puppeteer');
    attempts.push({
      provider: 'puppeteer',
      screenshot: puppeteerResult.screenshot,
      size: puppeteerResult.size,
      timeMs: puppeteerResult.timeMs,
      aiResult: null,
      issue: null,
    });
  } else {
    logger.error('Puppeteer preview failed - no preview available', { jobId, batchId, url });
  }

  // =========================================================================
  // Phase 3: Wait for other providers and do progressive AI evaluation
  // =========================================================================

  // Collect remaining provider results
  const remainingResults = await Promise.allSettled([browserlessPromise, urlboxPromise, zenrowsPromise]);

  for (const settled of remainingResults) {
    if (settled.status === 'fulfilled' && settled.value) {
      const result = settled.value;
      completedProviders.add(result.provider);
      attempts.push({
        provider: result.provider,
        screenshot: result.screenshot,
        size: result.size,
        timeMs: result.timeMs,
        aiResult: null,
        issue: null,
      });
      logger.info('Provider completed', { jobId, url, provider: result.provider, timeMs: result.timeMs });
    }
  }

  logger.info('All providers completed', {
    jobId, batchId, url,
    completedCount: completedProviders.size,
    providers: Array.from(completedProviders),
  });

  // =========================================================================
  // Phase 4: AI evaluation (only if 2+ providers completed)
  // =========================================================================
  if (attempts.length >= 2) {
    logger.info('Triggering AI evaluation', { jobId, url, attemptCount: attempts.length });
    aiEvalCount++;

    for (const attempt of attempts) {
      if (!attempt.aiResult) {
        const ai = await checkAI(attempt.screenshot);
        attempt.aiResult = ai;
        attempt.issue = issueFromAI(ai);
      }
    }

    bestSoFar = selectBest(attempts);
    logger.info('AI evaluation complete', {
      jobId, url,
      evalCount: aiEvalCount,
      bestProvider: bestSoFar?.provider,
      bestIssue: bestSoFar?.issue,
    });
  } else if (attempts.length === 1) {
    // Only one provider succeeded — still do AI check
    const ai = await checkAIWithRemediation(attempts[0].screenshot, url);
    attempts[0].aiResult = ai;
    attempts[0].issue = issueFromAI(ai);
    bestSoFar = attempts[0];
  }

  // =========================================================================
  // Phase 5: Remediation (up to 4 attempts, 6-second budget)
  // =========================================================================
  if (bestSoFar && isBestStillBad(attempts)) {
    logger.info('Best result has issues, attempting remediation', { jobId, url, issue: bestSoFar.issue });

    const remediationStart = Date.now();
    const REMEDIATION_BUDGET_MS = 6000;
    const MAX_REMEDIATION_ATTEMPTS = 4;
    const previousRemediationAttempts: Array<{ actions: string; reason: string }> = [];

    for (let attempt = 0; attempt < MAX_REMEDIATION_ATTEMPTS; attempt++) {
      const elapsed = Date.now() - remediationStart;
      if (elapsed > REMEDIATION_BUDGET_MS) {
        logger.info('Remediation time budget exceeded', { jobId, url, attempt, elapsed });
        break;
      }

      const latestScreenshot = attempts[attempts.length - 1].screenshot;
      const latestAI = await checkAIWithRemediation(latestScreenshot, url, 'image/webp', previousRemediationAttempts);

      if (!latestAI?.hasPaywall || !latestAI.remediation) {
        logger.info('No paywall or no remediation plan', { jobId, url, attempt });
        break;
      }

      const plan = latestAI.remediation;
      previousRemediationAttempts.push({
        actions: JSON.stringify(plan.actions),
        reason: plan.reasoning,
      });

      try {
        const retryResult = await takePuppeteerScreenshot(url, {
          actions: plan.actions,
          extraHeaders: plan.headers,
          preCookies: plan.cookies,
        });

        const retryAI = await checkAI(retryResult.screenshot);

        attempts.push({
          provider: 'puppeteer+actions',
          screenshot: retryResult.screenshot,
          size: retryResult.size,
          timeMs: retryResult.timeMs,
          aiResult: retryAI,
          issue: issueFromAI(retryAI),
        });

        if (retryAI && retryAI.isValid && !retryAI.hasPaywall && !retryAI.hasError) {
          logger.info('Remediation succeeded', { jobId, url, attempt });
          break;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        logger.warn('Remediation attempt failed', { jobId, url, attempt, error: errorMsg });
      }
    }

    const remediationElapsed = Date.now() - remediationStart;
    logger.info('Remediation phase complete', {
      jobId, url,
      elapsed: remediationElapsed,
      attempts: previousRemediationAttempts.length,
    });
  }

  // =========================================================================
  // Phase 6: Select best, write optimized image and result
  // =========================================================================
  const finalBest = selectBest(attempts) ?? attempts[0] ?? null;

  if (finalBest) {
    // Write optimized image to S3 as binary
    await writeImageToS3(jobId, 'optimized.webp', finalBest.screenshot);

    logger.info('Optimized image written', { jobId, url, provider: finalBest.provider });
  }

  // Write vendor scores
  await writeVendorScores(url, attempts);

  // Write final result JSON (no base64)
  await writeFinalResult(jobId, batchId, url, previewData, attempts, finalBest);

  const totalTimeMs = Date.now() - orchestrationStart;
  await writeJobStatus(jobId, batchId, url, 'completed', { timeMs: totalTimeMs });

  logger.info('Orchestration complete', {
    jobId, batchId, url,
    timeMs: totalTimeMs,
    attemptCount: attempts.length,
    bestProvider: finalBest?.provider ?? 'none',
  });
}

// =============================================================================
// Public entry point
// =============================================================================

/**
 * Core orchestration flow for a single URL.
 * Called by the SQS worker for each job.
 *
 * 1. Launch ALL providers in parallel (Puppeteer + Browserless + URLBox + ZenRows)
 * 2. As Puppeteer completes first -> write preview.webp to S3, write result JSON with phase: "preview"
 * 3. Track completed providers. When 2+ are done -> trigger AI evaluation on all available
 * 4. If more providers finish later -> re-evaluate with new results
 * 5. If paywall detected on best -> remediate up to 4 times within 6-second budget
 * 6. 40-second hard cutoff on the entire job
 * 7. Write vendor scores to S3
 * 8. Write final optimized.webp and result JSON
 */
export async function orchestrate(
  url: string,
  jobId: string,
  batchId: string,
  takePuppeteerScreenshot: (url: string, options?: {
    actions?: unknown[];
    extraHeaders?: Record<string, string>;
    preCookies?: Array<{ name: string; value: string; domain: string }>;
  }) => Promise<{ screenshot: string; size: number; timeMs: number }>,
): Promise<void> {
  const orchestrationStart = Date.now();
  logger.info('Orchestration started', { jobId, batchId, url });

  // 40-second hard cutoff
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), 40000);
  });

  try {
    const result = await Promise.race([
      runOrchestration(url, jobId, batchId, takePuppeteerScreenshot, orchestrationStart),
      timeoutPromise,
    ]);

    if (result === 'timeout') {
      logger.warn('Orchestration hit 40s timeout', { jobId, batchId, url, elapsed: Date.now() - orchestrationStart });

      // Write timeout result
      const timeoutResult: OrchestrationResult = {
        jobId, batchId, url,
        phase: 'optimized',
        success: true,
        timedOut: true,
        completedAt: new Date().toISOString(),
      };
      await writeResult(jobId, timeoutResult);
      await writeJobStatus(jobId, batchId, url, 'completed', { timedOut: true, timeMs: Date.now() - orchestrationStart });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Orchestration failed', { jobId, batchId, url, error: errorMsg });

    const failResult: OrchestrationResult = {
      jobId, batchId, url,
      phase: 'optimized',
      success: false,
      error: errorMsg,
      completedAt: new Date().toISOString(),
    };
    await writeResult(jobId, failResult);
    await writeJobStatus(jobId, batchId, url, 'failed', { error: errorMsg });
  }
}
