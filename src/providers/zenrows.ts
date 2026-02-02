import type { ScreenshotResult } from '../types';

export async function takeScreenshot(
  url: string,
  apiKey: string
): Promise<ScreenshotResult> {
  const startTime = performance.now();

  if (!apiKey) {
    return {
      provider: 'zenrows',
      url,
      success: false,
      timeMs: 0,
      error: 'API key not configured',
    };
  }

  try {
    // ZenRows requires the URL to be properly encoded
    // We manually construct the query string to ensure proper encoding
    const params = new URLSearchParams({
      apikey: apiKey,
      js_render: 'true',
      screenshot: 'true',
      screenshot_fullpage: 'false',
    });

    // Double-encode the URL because Vite proxy decodes it once during forwarding
    const doubleEncodedUrl = encodeURIComponent(encodeURIComponent(url));
    const response = await fetch(`/api/zenrows/v1/?${params.toString()}&url=${doubleEncodedUrl}`);

    const timeMs = performance.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      return {
        provider: 'zenrows',
        url,
        success: false,
        timeMs,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    // ZenRows returns the screenshot as binary data
    const blob = await response.blob();
    const imageSize = blob.size;
    const imageData = await blobToDataUrl(blob);

    return {
      provider: 'zenrows',
      url,
      success: true,
      timeMs,
      imageData,
      imageSize,
    };
  } catch (error) {
    const timeMs = performance.now() - startTime;
    return {
      provider: 'zenrows',
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
