import type { QualityResult, ScreenshotResult } from '../types';

const MIN_FILE_SIZE = 10 * 1024; // 10KB minimum

// These patterns could be used for OCR-based text detection in the future
export const ERROR_PATTERNS = [
  /404\s*(not\s*found)?/i,
  /500\s*(internal\s*server\s*error)?/i,
  /503\s*(service\s*unavailable)?/i,
  /error\s*(occurred|loading|page)/i,
  /access\s*denied/i,
  /forbidden/i,
  /page\s*not\s*found/i,
  /something\s*went\s*wrong/i,
  /unable\s*to\s*load/i,
];

export const PAYWALL_PATTERNS = [
  /subscribe\s*(to\s*(continue|read|access))?/i,
  /sign\s*in\s*to\s*(continue|read|access)/i,
  /login\s*(required|to\s*continue)/i,
  /premium\s*(content|article|access)/i,
  /members?\s*only/i,
  /paywall/i,
  /free\s*trial/i,
  /unlock\s*(this\s*)?(article|content)/i,
];

export function checkFileSize(sizeBytes: number): boolean {
  return sizeBytes >= MIN_FILE_SIZE;
}

export async function checkForErrorText(_imageData: string): Promise<boolean> {
  // For now, we do a simple size-based heuristic
  // Very small images are likely error pages
  // This could be enhanced with OCR or AI vision
  return true; // Placeholder - would need OCR
}

export async function checkForPaywall(_imageData: string): Promise<boolean> {
  // This would use Claude's vision API to detect paywalls
  // For now, return true (no paywall detected)
  return true; // Placeholder - would need AI vision
}

export async function checkQuality(
  result: ScreenshotResult
): Promise<QualityResult> {
  const details: string[] = [];

  if (!result.success || !result.imageData || !result.imageSize) {
    return {
      passed: false,
      sizeOk: false,
      noErrorText: false,
      noPaywall: false,
      details: ['Screenshot failed or no data'],
    };
  }

  // Check file size
  const sizeOk = checkFileSize(result.imageSize);
  if (!sizeOk) {
    details.push(`File size too small: ${formatBytes(result.imageSize)}`);
  } else {
    details.push(`File size OK: ${formatBytes(result.imageSize)}`);
  }

  // Check for error text (placeholder)
  const noErrorText = await checkForErrorText(result.imageData);
  if (!noErrorText) {
    details.push('Error text detected in image');
  }

  // Check for paywall (placeholder)
  const noPaywall = await checkForPaywall(result.imageData);
  if (!noPaywall) {
    details.push('Paywall detected in image');
  }

  const passed = sizeOk && noErrorText && noPaywall;

  return {
    passed,
    sizeOk,
    noErrorText,
    noPaywall,
    details,
  };
}

export async function checkQualityWithAI(
  result: ScreenshotResult
): Promise<QualityResult> {
  const anthropicKey = import.meta.env.VITE_ANTHROPIC_API_KEY;

  // Start with basic checks
  const basicResult = await checkQuality(result);

  if (!anthropicKey || !result.imageData) {
    return basicResult;
  }

  try {
    // Extract base64 data from data URL
    const base64Match = result.imageData.match(/^data:image\/\w+;base64,(.+)$/);
    if (!base64Match) {
      return basicResult;
    }

    const base64Data = base64Match[1];
    const mediaType = result.imageData.includes('png') ? 'image/png' : result.imageData.includes('webp') ? 'image/webp' : 'image/jpeg';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data,
                },
              },
              {
                type: 'text',
                text: `Analyze this screenshot. Respond with ONLY a JSON object (no markdown):
{
  "hasError": boolean (true if shows 404, 500, error page, "page not found", etc),
  "hasPaywall": boolean (true if shows login wall, subscription prompt, "sign in to continue", etc),
  "isValid": boolean (true if it's a legitimate screenshot of website content),
  "reason": "brief explanation"
}`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn('AI quality check failed:', response.status);
      return basicResult;
    }

    const data = await response.json();
    const content = data.content?.[0]?.text;

    if (!content) {
      return basicResult;
    }

    const aiResult = JSON.parse(content);

    return {
      passed: basicResult.sizeOk && !aiResult.hasError && !aiResult.hasPaywall && aiResult.isValid,
      sizeOk: basicResult.sizeOk,
      noErrorText: !aiResult.hasError,
      noPaywall: !aiResult.hasPaywall,
      details: [
        ...basicResult.details,
        `AI: ${aiResult.reason}`,
      ],
    };
  } catch (error) {
    console.warn('AI quality check error:', error);
    return basicResult;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
