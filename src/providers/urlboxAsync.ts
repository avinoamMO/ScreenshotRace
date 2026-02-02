import type { ScreenshotResult } from '../types';
import { getNextInterval } from '../utils/pollWithBackoff';
import { Semaphore } from '../utils/semaphore';

interface AsyncRenderResponse {
  status: string;
  renderId: string;
  statusUrl: string;
}

interface RenderStatusResponse {
  status: 'created' | 'rendering' | 'succeeded' | 'failed';
  renderUrl?: string;
  size?: number;
  error?: string;
}

interface PendingJob {
  url: string;
  renderId: string;
  startTime: number;
}

// Batch function - fires ALL requests at once, polls for all results
export async function takeScreenshotBatch(
  urls: string[],
  apiKey: string,
  apiSecret: string,
  signal?: AbortSignal,
  onProgress?: (result: ScreenshotResult) => void
): Promise<ScreenshotResult[]> {
  if (!apiKey || !apiSecret) {
    return urls.map(url => ({
      provider: 'urlboxAsync',
      url,
      success: false,
      timeMs: 0,
      error: 'API key and secret not configured',
    }));
  }

  if (urls.length === 0) {
    return [];
  }

  // Check if already aborted
  if (signal?.aborted) {
    return urls.map(url => ({
      provider: 'urlboxAsync',
      url,
      success: false,
      timeMs: 0,
      error: 'Request cancelled',
    }));
  }

  // Step 1: Fire ALL async requests at once
  const pendingJobs: PendingJob[] = [];
  const failedUrls: ScreenshotResult[] = [];

  const firePromises = urls.map(async (url) => {
    const startTime = performance.now();

    // Check if aborted before each request
    if (signal?.aborted) {
      failedUrls.push({
        provider: 'urlboxAsync',
        url,
        success: false,
        timeMs: 0,
        error: 'Request cancelled',
      });
      return;
    }

    try {
      const response = await fetch('/api/urlbox/v1/render/async', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          format: 'png',
          width: 1280,
          height: 800,
          force: true,  // Disable URLBox caching - always take fresh screenshot
        }),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        failedUrls.push({
          provider: 'urlboxAsync',
          url,
          success: false,
          timeMs: performance.now() - startTime,
          error: `HTTP ${response.status}: ${errorText}`,
        });
        return;
      }

      const asyncResult = await response.json() as AsyncRenderResponse;
      pendingJobs.push({
        url,
        renderId: asyncResult.renderId,
        startTime,
      });
    } catch (error) {
      failedUrls.push({
        provider: 'urlboxAsync',
        url,
        success: false,
        timeMs: performance.now() - startTime,
        error: error instanceof Error ? error.message : 'Failed to start async job',
      });
    }
  });

  await Promise.all(firePromises);

  // Step 2: Poll ALL pending jobs until complete
  const results: ScreenshotResult[] = [...failedUrls];
  const completedRenderIds = new Set<string>();

  const maxAttempts = 120; // With backoff: starts at 200ms, maxes at 2000ms

  // Semaphore to limit concurrent image downloads (max 5 at once)
  const downloadSemaphore = new Semaphore(5);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (completedRenderIds.size >= pendingJobs.length) {
      break; // All done
    }

    // Check if aborted before polling
    if (signal?.aborted) {
      // Return partial results plus cancelled for incomplete
      for (const job of pendingJobs) {
        if (!completedRenderIds.has(job.renderId)) {
          results.push({
            provider: 'urlboxAsync',
            url: job.url,
            success: false,
            timeMs: performance.now() - job.startTime,
            error: 'Request cancelled',
          });
        }
      }
      return results;
    }

    const pollInterval = getNextInterval(attempt);
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    // Poll all pending jobs in parallel
    const pollPromises = pendingJobs
      .filter(job => !completedRenderIds.has(job.renderId))
      .map(async (job) => {
        // Check if aborted
        if (signal?.aborted) return;

        try {
          const statusResponse = await fetch(`/api/urlbox/v1/render/${job.renderId}`, {
            headers: {
              'Authorization': `Bearer ${apiSecret}`,
            },
            signal,
          });

          if (!statusResponse.ok) {
            return; // Retry next iteration
          }

          const status = await statusResponse.json() as RenderStatusResponse;

          if (status.status === 'succeeded' && status.renderUrl) {
            completedRenderIds.add(job.renderId);

            // Fetch the actual image (with semaphore to limit concurrent downloads)
            await downloadSemaphore.withLock(async () => {
              // Check if aborted before downloading
              if (signal?.aborted) {
                results.push({
                  provider: 'urlboxAsync',
                  url: job.url,
                  success: false,
                  timeMs: performance.now() - job.startTime,
                  error: 'Request cancelled',
                });
                return;
              }

              try {
                const imageResponse = await fetch(status.renderUrl!, { signal });
                if (imageResponse.ok) {
                  const blob = await imageResponse.blob();
                  const imageData = await blobToDataUrl(blob);

                  const successResult: ScreenshotResult = {
                    provider: 'urlboxAsync',
                    url: job.url,
                    success: true,
                    timeMs: performance.now() - job.startTime,
                    imageData,
                    imageSize: blob.size,
                  };
                  results.push(successResult);
                  onProgress?.(successResult);
                } else {
                  const failResult: ScreenshotResult = {
                    provider: 'urlboxAsync',
                    url: job.url,
                    success: false,
                    timeMs: performance.now() - job.startTime,
                    error: 'Failed to fetch rendered image',
                  };
                  results.push(failResult);
                  onProgress?.(failResult);
                }
              } catch (error) {
                const errorResult: ScreenshotResult = {
                  provider: 'urlboxAsync',
                  url: job.url,
                  success: false,
                  timeMs: performance.now() - job.startTime,
                  error: 'Failed to fetch rendered image',
                };
                results.push(errorResult);
                onProgress?.(errorResult);
              }
            });
          } else if (status.status === 'failed') {
            completedRenderIds.add(job.renderId);
            results.push({
              provider: 'urlboxAsync',
              url: job.url,
              success: false,
              timeMs: performance.now() - job.startTime,
              error: status.error || 'Render failed',
            });
          }
          // Otherwise still rendering, continue polling
        } catch (error) {
          // Network error, retry next iteration
        }
      });

    await Promise.all(pollPromises);
  }

  // Add timeout results for any jobs that didn't complete
  for (const job of pendingJobs) {
    if (!completedRenderIds.has(job.renderId)) {
      results.push({
        provider: 'urlboxAsync',
        url: job.url,
        success: false,
        timeMs: performance.now() - job.startTime,
        error: 'Polling timeout - render took too long',
      });
    }
  }

  return results;
}

// Single URL function (for backwards compatibility)
export async function takeScreenshot(
  url: string,
  apiKey: string,
  apiSecret: string,
  signal?: AbortSignal
): Promise<ScreenshotResult> {
  const results = await takeScreenshotBatch([url], apiKey, apiSecret, signal);
  return results[0];
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
