import type { ScreenshotResult } from '../types';

export async function takeScreenshot(
  url: string,
  apiKey: string,
  secret: string
): Promise<ScreenshotResult> {
  const startTime = performance.now();

  if (!apiKey || !secret) {
    return {
      provider: 'urlbox',
      url,
      success: false,
      timeMs: 0,
      error: 'API key or secret not configured',
    };
  }

  try {
    const params = new URLSearchParams({
      url,
      format: 'jpeg',
      quality: '85',
      width: '1280',
      height: '800',
      delay: '2000',
    });

    const queryString = params.toString();
    const token = await generateHmacSignature(queryString, secret);

    // URLBox API: https://api.urlbox.com/v1/{apiKey}/{token}/jpeg?{queryString}
    const response = await fetch(
      `/api/urlbox/v1/${apiKey}/${token}/jpeg?${queryString}`
    );

    const timeMs = performance.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      return {
        provider: 'urlbox',
        url,
        success: false,
        timeMs,
        error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
      };
    }

    const blob = await response.blob();
    const imageSize = blob.size;
    const imageData = await blobToDataUrl(blob);

    return {
      provider: 'urlbox',
      url,
      success: true,
      timeMs,
      imageData,
      imageSize,
    };
  } catch (error) {
    const timeMs = performance.now() - startTime;
    return {
      provider: 'urlbox',
      url,
      success: false,
      timeMs,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function generateHmacSignature(
  message: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
