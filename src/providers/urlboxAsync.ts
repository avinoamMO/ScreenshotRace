import type { ScreenshotResult } from '../types';

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
  apiSecret: string
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

  // Step 1: Fire ALL async requests at once
  const pendingJobs: PendingJob[] = [];
  const failedUrls: ScreenshotResult[] = [];

  const firePromises = urls.map(async (url) => {
    const startTime = performance.now();

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
        }),
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

  const maxAttempts = 120; // 120 * 500ms = 60 seconds
  const pollInterval = 500;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (completedRenderIds.size >= pendingJobs.length) {
      break; // All done
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));

    // Poll all pending jobs in parallel
    const pollPromises = pendingJobs
      .filter(job => !completedRenderIds.has(job.renderId))
      .map(async (job) => {
        try {
          const statusResponse = await fetch(`/api/urlbox/v1/render/${job.renderId}`, {
            headers: {
              'Authorization': `Bearer ${apiSecret}`,
            },
          });

          if (!statusResponse.ok) {
            return; // Retry next iteration
          }

          const status = await statusResponse.json() as RenderStatusResponse;

          if (status.status === 'succeeded' && status.renderUrl) {
            completedRenderIds.add(job.renderId);

            // Fetch the actual image
            try {
              const imageResponse = await fetch(status.renderUrl);
              if (imageResponse.ok) {
                const blob = await imageResponse.blob();
                const imageData = await blobToDataUrl(blob);

                results.push({
                  provider: 'urlboxAsync',
                  url: job.url,
                  success: true,
                  timeMs: performance.now() - job.startTime,
                  imageData,
                  imageSize: blob.size,
                });
              } else {
                results.push({
                  provider: 'urlboxAsync',
                  url: job.url,
                  success: false,
                  timeMs: performance.now() - job.startTime,
                  error: 'Failed to fetch rendered image',
                });
              }
            } catch (error) {
              results.push({
                provider: 'urlboxAsync',
                url: job.url,
                success: false,
                timeMs: performance.now() - job.startTime,
                error: 'Failed to fetch rendered image',
              });
            }
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
  apiSecret: string
): Promise<ScreenshotResult> {
  const results = await takeScreenshotBatch([url], apiKey, apiSecret);
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
