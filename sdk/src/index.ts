/**
 * ScreenshotRace SDK
 *
 * A lightweight TypeScript client for the ScreenshotRace API.
 *
 * @example
 * ```typescript
 * import { ScreenshotRace } from 'screenshot-race-sdk';
 *
 * const client = new ScreenshotRace({
 *   apiKey: 'your-api-key',
 *   baseUrl: 'https://your-api.execute-api.us-east-1.amazonaws.com/dev',
 * });
 *
 * const result = await client.capture('https://example.com');
 * console.log(result.optimized?.provider);
 * console.log(result.presignedUrls.optimized);
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the ScreenshotRace client. */
export interface ScreenshotRaceConfig {
  /** Your API key for authentication. */
  apiKey: string;
  /** Base URL of the deployed ScreenshotRace API (no trailing slash). */
  baseUrl: string;
  /** Polling interval in milliseconds. Default: 2000. */
  pollIntervalMs?: number;
  /** Maximum time to wait for results in milliseconds. Default: 60000. */
  timeoutMs?: number;
}

/** Presigned S3 URLs for the screenshot images. */
export interface PresignedUrls {
  /** Fast preview (available within ~3s). */
  preview: string;
  /** Final optimized result (available when job completes). */
  optimized: string;
}

/** A single job in a batch response. */
export interface Job {
  jobId: string;
  url: string;
  status: string;
  presignedUrls?: PresignedUrls;
}

/** Response from the screenshot submission endpoint. */
export interface SubmitResponse {
  batchId: string;
  jobs: Job[];
  message: string;
}

/** AI quality assessment for a screenshot. */
export interface QualityResult {
  score: number;
  aiVerdict: string;
  noPaywall: boolean;
  noError: boolean;
}

/** Details of a single provider attempt. */
export interface AttemptResult {
  provider: string;
  score: number;
  issue: string | null;
}

/** Optimized screenshot details. */
export interface OptimizedResult {
  provider: string;
  timeMs: number;
  size: number;
  quality: QualityResult;
  retryAttempt?: number;
  retryReason?: string;
  attempts: AttemptResult[];
}

/** Preview screenshot details. */
export interface PreviewResult {
  provider: string;
  timeMs: number;
  size: number;
}

/** Full result for a single screenshot job. */
export interface JobResult {
  jobId: string;
  batchId: string;
  url: string;
  phase: 'preview' | 'optimized';
  success: boolean;
  timedOut?: boolean;
  preview?: PreviewResult;
  optimized?: OptimizedResult;
  error?: string;
  completedAt: string;
}

/** Batch results response from the polling endpoint. */
export interface BatchResults {
  batchId: string;
  totalJobs: number;
  completed: number;
  pending: number;
  allComplete: boolean;
  results: JobResult[];
}

/** Capture result returned by the high-level capture method. */
export interface CaptureResult extends JobResult {
  /** Presigned URLs for downloading the images directly. */
  presignedUrls: PresignedUrls;
}

/** Error thrown by the SDK on API failures. */
export class ScreenshotRaceError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: string,
  ) {
    super(message);
    this.name = 'ScreenshotRaceError';
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * ScreenshotRace API client.
 *
 * Provides methods for submitting screenshot jobs, polling for results,
 * and a high-level `capture` method that handles the full lifecycle.
 */
export class ScreenshotRace {
  private apiKey: string;
  private baseUrl: string;
  private pollIntervalMs: number;
  private timeoutMs: number;

  constructor(config: ScreenshotRaceConfig) {
    if (!config.apiKey) throw new Error('apiKey is required');
    if (!config.baseUrl) throw new Error('baseUrl is required');

    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.pollIntervalMs = config.pollIntervalMs ?? 2000;
    this.timeoutMs = config.timeoutMs ?? 60000;
  }

  /**
   * Warm up the Lambda worker to reduce cold start latency.
   * Call this before your first screenshot if latency matters.
   */
  async warmup(): Promise<void> {
    await this.request('GET', '/wakeup');
  }

  /**
   * Submit one or more URLs for screenshotting.
   * Returns immediately with job IDs and presigned URLs.
   */
  async submit(urls: string | string[]): Promise<SubmitResponse> {
    const response = await this.request('POST', '/screenshot-optimized', {
      urls,
    });
    return response as SubmitResponse;
  }

  /**
   * Poll for results of a batch.
   * Returns the current state of all jobs in the batch.
   */
  async getResults(batchId: string): Promise<BatchResults> {
    const response = await this.request('GET', `/results?batchId=${batchId}`);
    return response as BatchResults;
  }

  /**
   * Poll for results of a single job.
   */
  async getJobResult(jobId: string): Promise<JobResult> {
    const response = await this.request('GET', `/results/${jobId}`);
    return response as JobResult;
  }

  /**
   * High-level method: submit a single URL and wait for the result.
   *
   * Handles the full lifecycle: submit -> poll -> return result.
   * Throws on timeout or failure.
   *
   * @param url - The URL to screenshot.
   * @returns The completed job result with presigned image URLs.
   *
   * @example
   * ```typescript
   * const result = await client.capture('https://example.com');
   * console.log(result.optimized?.quality.score); // 9
   * console.log(result.presignedUrls.optimized);  // S3 URL
   * ```
   */
  async capture(url: string): Promise<CaptureResult> {
    const submitRes = await this.submit(url);
    const job = submitRes.jobs[0];

    if (!job || job.status === 'invalid_url') {
      throw new ScreenshotRaceError(
        `Invalid URL: ${url}`,
        400,
      );
    }

    const result = await this.waitForCompletion(submitRes.batchId);
    const jobResult = result.results[0];

    return {
      ...jobResult,
      presignedUrls: job.presignedUrls!,
    };
  }

  /**
   * High-level method: submit multiple URLs and wait for all results.
   *
   * @param urls - Array of URLs to screenshot.
   * @returns Array of completed job results with presigned image URLs.
   */
  async captureMany(urls: string[]): Promise<CaptureResult[]> {
    const submitRes = await this.submit(urls);
    const result = await this.waitForCompletion(submitRes.batchId);

    return result.results.map((r, i) => ({
      ...r,
      presignedUrls: submitRes.jobs[i]?.presignedUrls ?? {
        preview: '',
        optimized: '',
      },
    }));
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async waitForCompletion(batchId: string): Promise<BatchResults> {
    const deadline = Date.now() + this.timeoutMs;

    while (Date.now() < deadline) {
      await this.sleep(this.pollIntervalMs);
      const results = await this.getResults(batchId);

      if (results.allComplete) {
        return results;
      }
    }

    throw new ScreenshotRaceError(
      `Timeout waiting for batch ${batchId} after ${this.timeoutMs}ms`,
      408,
    );
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
    };

    const init: RequestInit = {
      method,
      headers,
    };

    if (body) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ScreenshotRaceError(
        `API error: ${response.status} ${response.statusText}`,
        response.status,
        text,
      );
    }

    return response.json();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default ScreenshotRace;
