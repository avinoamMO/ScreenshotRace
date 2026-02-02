import type { ScreenshotResult } from '../types';

export async function takeScreenshot(
  url: string,
  apiKey: string
): Promise<ScreenshotResult> {
  const startTime = performance.now();

  if (!apiKey) {
    return {
      provider: 'browserless',
      url,
      success: false,
      timeMs: 0,
      error: 'API key not configured',
    };
  }

  try {
    const response = await fetch(`/api/browserless/screenshot?token=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        options: {
          type: 'jpeg',
          quality: 85,
          fullPage: false,
        },
        gotoOptions: {
          waitUntil: 'networkidle2',
          timeout: 30000,
        },
      }),
    });

    const timeMs = performance.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      return {
        provider: 'browserless',
        url,
        success: false,
        timeMs,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const blob = await response.blob();
    const imageSize = blob.size;
    const imageData = await blobToDataUrl(blob);

    return {
      provider: 'browserless',
      url,
      success: true,
      timeMs,
      imageData,
      imageSize,
    };
  } catch (error) {
    const timeMs = performance.now() - startTime;
    return {
      provider: 'browserless',
      url,
      success: false,
      timeMs,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
