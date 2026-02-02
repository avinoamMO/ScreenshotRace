import type { ScreenshotResult } from '../types';
import { getNextInterval } from '../utils/pollWithBackoff';

interface AsyncJob {
  jobId: string;
  url: string;
  status: string;
}

interface AsyncScreenshotResponse {
  batchId: string;
  jobs: AsyncJob[];
  message: string;
}

interface BatchResultsResponse {
  batchId: string;
  totalJobs: number;
  completed: number;
  pending: number;
  allComplete: boolean;
  results: Array<{
    jobId: string;
    url?: string;
    success?: boolean;
    screenshot?: string;
    size?: number;
    timeMs?: number;
    error?: string;
    status?: string;
  }>;
}

// Batch function - sends ALL URLs at once, polls for all results
export async function takeScreenshotBatch(
  urls: string[],
  lambdaUrl: string,
  signal?: AbortSignal,
  onProgress?: (result: ScreenshotResult) => void
): Promise<ScreenshotResult[]> {
  const startTime = performance.now();

  if (!lambdaUrl) {
    return urls.map(url => ({
      provider: 'lambdaAsync',
      url,
      success: false,
      timeMs: 0,
      error: 'Lambda URL not configured',
    }));
  }

  if (urls.length === 0) {
    return [];
  }

  // Check if already aborted
  if (signal?.aborted) {
    return urls.map(url => ({
      provider: 'lambdaAsync',
      url,
      success: false,
      timeMs: 0,
      error: 'Request cancelled',
    }));
  }

  try {
    // Step 1: Queue ALL jobs at once
    const response = await fetch(`${lambdaUrl}/screenshot-async`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        urls,
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return urls.map(url => ({
        provider: 'lambdaAsync',
        url,
        success: false,
        timeMs: performance.now() - startTime,
        error: `HTTP ${response.status}: ${errorText}`,
      }));
    }

    const asyncResult = await response.json() as AsyncScreenshotResponse;
    const { batchId, jobs } = asyncResult;

    // Create a map of URL to jobId for tracking
    const urlToJob = new Map<string, AsyncJob>();
    for (const job of jobs) {
      urlToJob.set(job.url, job);
    }

    // Step 2: Poll until ALL jobs complete
    const maxAttempts = 180; // With backoff: starts at 200ms, maxes at 2000ms
    const results: ScreenshotResult[] = [];
    const completedUrls = new Set<string>();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (completedUrls.size >= urls.length) {
        break; // All done
      }

      // Check if aborted before polling
      if (signal?.aborted) {
        // Return partial results plus cancelled for incomplete
        for (const url of urls) {
          if (!completedUrls.has(url)) {
            results.push({
              provider: 'lambdaAsync',
              url,
              success: false,
              timeMs: performance.now() - startTime,
              error: 'Request cancelled',
            });
          }
        }
        return results;
      }

      // Wait AFTER first poll, not before (poll immediately first time)
      if (attempt > 0) {
        const pollInterval = getNextInterval(attempt - 1);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      try {
        const resultsResponse = await fetch(`${lambdaUrl}/results?batchId=${batchId}`, { signal });

        if (!resultsResponse.ok) {
          continue;
        }

        const batchResults = await resultsResponse.json() as BatchResultsResponse;

        // Process any newly completed results
        for (const result of batchResults.results) {
          const url = result.url;
          if (!url || completedUrls.has(url)) {
            continue;
          }

          if (result.success !== undefined) {
            completedUrls.add(url);

            let screenshotResult: ScreenshotResult;
            if (result.success && result.screenshot) {
              screenshotResult = {
                provider: 'lambdaAsync',
                url,
                success: true,
                timeMs: result.timeMs || (performance.now() - startTime),
                imageData: `data:image/webp;base64,${result.screenshot}`,
                imageSize: result.size,
              };
            } else {
              screenshotResult = {
                provider: 'lambdaAsync',
                url,
                success: false,
                timeMs: result.timeMs || (performance.now() - startTime),
                error: result.error || 'Screenshot failed',
              };
            }
            results.push(screenshotResult);
            onProgress?.(screenshotResult);  // Report result immediately as it completes
          }
        }

        if (batchResults.allComplete) {
          break;
        }
      } catch (error) {
        // Continue polling on error
        console.error('Poll error:', error);
      }
    }

    // Add timeout results for any URLs that didn't complete
    for (const url of urls) {
      if (!completedUrls.has(url)) {
        results.push({
          provider: 'lambdaAsync',
          url,
          success: false,
          timeMs: performance.now() - startTime,
          error: 'Polling timeout - job not completed in time',
        });
      }
    }

    return results;
  } catch (error) {
    return urls.map(url => ({
      provider: 'lambdaAsync',
      url,
      success: false,
      timeMs: performance.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

// Single URL function (for backwards compatibility)
export async function takeScreenshot(
  url: string,
  lambdaUrl: string,
  signal?: AbortSignal
): Promise<ScreenshotResult> {
  const results = await takeScreenshotBatch([url], lambdaUrl, signal);
  return results[0];
}
