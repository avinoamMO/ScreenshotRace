import type { ScreenshotResult } from '../types';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { withRetry } from '../utils/retry';

export async function takeScreenshot(
  url: string,
  lambdaUrl: string,
  signal?: AbortSignal
): Promise<ScreenshotResult> {
  const startTime = performance.now();

  if (!lambdaUrl) {
    return {
      provider: 'lambda',
      url,
      success: false,
      timeMs: 0,
      error: 'Lambda URL not configured',
    };
  }

  // Check if already aborted
  if (signal?.aborted) {
    return {
      provider: 'lambda',
      url,
      success: false,
      timeMs: 0,
      error: 'Request cancelled',
    };
  }

  try {
    const response = await withRetry(
      () => fetchWithTimeout(
        `${lambdaUrl}/screenshot`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url }),
        },
        30000,
        signal
      ),
      { maxAttempts: 2 }
    );

    const timeMs = performance.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      return {
        provider: 'lambda',
        url,
        success: false,
        timeMs,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const data = await response.json();

    if (!data.screenshot) {
      return {
        provider: 'lambda',
        url,
        success: false,
        timeMs,
        error: 'No screenshot data in response',
      };
    }

    // Lambda returns base64 encoded WebP image
    const imageData = `data:image/webp;base64,${data.screenshot}`;
    const imageSize = Math.round((data.screenshot.length * 3) / 4); // Approximate size from base64

    return {
      provider: 'lambda',
      url,
      success: true,
      timeMs,
      imageData,
      imageSize,
    };
  } catch (error) {
    const timeMs = performance.now() - startTime;
    return {
      provider: 'lambda',
      url,
      success: false,
      timeMs,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
