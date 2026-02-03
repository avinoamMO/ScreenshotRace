import https from 'https';

export interface AIQualityResult {
  hasError: boolean;
  hasPaywall: boolean;
  isValid: boolean;
  reason: string;
}

export interface PaywallRemediationPlan {
  actions: Array<{
    action: string;
    selector?: string;
    value?: string;
    x?: number;
    y?: number;
    delayMs?: number;
    cookie?: { name: string; value: string; domain?: string };
  }>;
  headers?: Record<string, string>;
  cookies?: Array<{ name: string; value: string; domain: string }>;
  reasoning: string;
}

export interface AIQualityResultWithRemediation extends AIQualityResult {
  remediation?: PaywallRemediationPlan;
}

function anthropicRequest(body: object, maxTokens: number): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Promise.resolve(null);

  const payload = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    ...body,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 30000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            const content = data.content?.[0]?.text;
            resolve(content || null);
          } catch {
            resolve(null);
          }
        });
        res.on('error', reject);
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('Anthropic API timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Basic AI quality check. Sends screenshot to Claude for analysis.
 * Returns null if no API key or on failure.
 */
export async function checkAI(imageBase64: string, mediaType = 'image/webp'): Promise<AIQualityResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const content = await anthropicRequest(
      {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: imageBase64,
                },
              },
              {
                type: 'text',
                text: `Analyze this screenshot. Respond with ONLY a JSON object (no markdown):
{
  "hasError": boolean (true if shows 404, 500, error page, "page not found", etc),
  "hasPaywall": boolean (true if shows login wall, subscription prompt, "sign in to continue", etc),
  "isValid": boolean (true if it's a legitimate screenshot of website content),
  "reason": "one word: OK, Error, 404, 500, Paywall, Blocked, or Empty"
}`,
              },
            ],
          },
        ],
      },
      256
    );

    if (!content) return null;

    const parsed = JSON.parse(content);
    return {
      hasError: !!parsed.hasError,
      hasPaywall: !!parsed.hasPaywall,
      isValid: !!parsed.isValid,
      reason: String(parsed.reason || ''),
    };
  } catch {
    return null;
  }
}

/**
 * Enhanced AI quality check that returns a remediation plan when a paywall is detected.
 * Passes previous failed attempts so the AI can try different strategies.
 */
export async function checkAIWithRemediation(
  imageBase64: string,
  url: string,
  mediaType = 'image/webp',
  previousAttempts?: Array<{ actions: string; reason: string }>
): Promise<AIQualityResultWithRemediation | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    let previousAttemptsContext = '';
    if (previousAttempts && previousAttempts.length > 0) {
      previousAttemptsContext = `\n\nPrevious bypass attempts that FAILED (do NOT repeat these strategies):\n${previousAttempts.map((a, i) => `Attempt ${i + 1}: ${a.reason}\nActions: ${a.actions}`).join('\n')}`;
    }

    const content = await anthropicRequest(
      {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: imageBase64,
                },
              },
              {
                type: 'text',
                text: `Analyze this screenshot of ${url}. Respond with ONLY a JSON object (no markdown):

If the page shows a paywall, login wall, subscription prompt, cookie consent overlay, or any access barrier, include a "remediation" field with browser actions to bypass it.

Available action types: click (with selector or x,y), scroll (with x,y), type (selector + value), wait (delayMs), waitForSelector (selector), pressKey (value like "Escape"), clearCookies, setCookie (cookie object with name,value,domain).

Common strategies:
- Click dismiss/close buttons on overlays
- Press Escape to close modals
- Set cookies to indicate consent or prior visit
- Set Referer header to Google to appear as organic traffic
- Scroll past overlay content
${previousAttemptsContext}

{
  "hasError": boolean,
  "hasPaywall": boolean,
  "isValid": boolean,
  "reason": "OK | Error | 404 | 500 | Paywall | Blocked | Empty",
  "remediation": {
    "actions": [{"action": "click", "selector": ".dismiss-btn"}],
    "headers": {"Referer": "https://www.google.com"},
    "cookies": [{"name": "consent", "value": "1", "domain": "example.com"}],
    "reasoning": "brief explanation of the bypass strategy"
  }
}

Only include "remediation" if hasPaywall is true. If no paywall, omit the remediation field entirely.`,
              },
            ],
          },
        ],
      },
      1024
    );

    if (!content) return null;

    // Strip markdown code fences if present
    const cleanContent = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleanContent);

    const result: AIQualityResultWithRemediation = {
      hasError: !!parsed.hasError,
      hasPaywall: !!parsed.hasPaywall,
      isValid: !!parsed.isValid,
      reason: String(parsed.reason || ''),
    };

    if (parsed.remediation && parsed.hasPaywall) {
      result.remediation = {
        actions: Array.isArray(parsed.remediation.actions) ? parsed.remediation.actions : [],
        headers: parsed.remediation.headers || undefined,
        cookies: Array.isArray(parsed.remediation.cookies) ? parsed.remediation.cookies : undefined,
        reasoning: String(parsed.remediation.reasoning || ''),
      };
    }

    return result;
  } catch {
    return null;
  }
}
