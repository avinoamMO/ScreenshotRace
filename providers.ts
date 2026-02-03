import crypto from 'crypto';
import https from 'https';
import http from 'http';

export interface ProviderResult {
  screenshot: string; // base64
  provider: string;
  timeMs: number;
  size: number; // bytes (approximate from base64)
}

function base64Size(base64: string): number {
  return Math.round((base64.length * 3) / 4);
}

function httpsGet(url: string, timeoutMs = 30000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        httpsGet(res.headers.location, timeoutMs).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
  });
}

function httpsPost(url: string, body: string | Buffer, headers: Record<string, string>, timeoutMs = 30000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: timeoutMs,
    };
    const req = https.request(options, (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const errBody = Buffer.concat(chunks).toString();
          reject(new Error(`HTTP ${res.statusCode}: ${errBody.slice(0, 200)}`));
        });
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// =============================================================================
// BROWSERLESS
// =============================================================================

export async function screenshotViaBrowserless(
  url: string,
  options?: { width?: number; height?: number }
): Promise<ProviderResult> {
  const apiKey = process.env.BROWSERLESS_API_KEY;
  if (!apiKey) throw new Error('BROWSERLESS_API_KEY not configured');

  const startTime = Date.now();

  const body = JSON.stringify({
    url,
    options: {
      type: 'webp',
      quality: 80,
      fullPage: false,
    },
    gotoOptions: {
      waitUntil: 'networkidle2',
      timeout: 30000,
    },
    viewport: {
      width: options?.width ?? 1280,
      height: options?.height ?? 800,
    },
  });

  const responseBuffer = await httpsPost(
    `https://chrome.browserless.io/screenshot?token=${apiKey}`,
    body,
    { 'Content-Type': 'application/json' },
    45000
  );

  const screenshot = responseBuffer.toString('base64');
  const timeMs = Date.now() - startTime;

  return {
    screenshot,
    provider: 'browserless',
    timeMs,
    size: base64Size(screenshot),
  };
}

// =============================================================================
// URLBOX
// =============================================================================

export async function screenshotViaUrlbox(
  url: string,
  options?: { width?: number; height?: number; delay?: number }
): Promise<ProviderResult> {
  const apiKey = process.env.URLBOX_API_KEY;
  const apiSecret = process.env.URLBOX_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error('URLBOX_API_KEY/URLBOX_API_SECRET not configured');

  const startTime = Date.now();

  const params = new URLSearchParams({
    url,
    format: 'webp',
    quality: '80',
    width: String(options?.width ?? 1280),
    height: String(options?.height ?? 800),
    delay: String(options?.delay ?? 3000),
    force: 'true',
  });

  const queryString = params.toString();
  const token = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
  const requestUrl = `https://api.urlbox.com/v1/${apiKey}/${token}/webp?${queryString}`;

  const responseBuffer = await httpsGet(requestUrl, 60000);
  const screenshot = responseBuffer.toString('base64');
  const timeMs = Date.now() - startTime;

  return {
    screenshot,
    provider: 'urlbox',
    timeMs,
    size: base64Size(screenshot),
  };
}

// =============================================================================
// ZENROWS
// =============================================================================

export async function screenshotViaZenrows(
  url: string,
): Promise<ProviderResult> {
  const apiKey = process.env.ZENROWS_API_KEY;
  if (!apiKey) throw new Error('ZENROWS_API_KEY not configured');

  const startTime = Date.now();

  const params = new URLSearchParams({
    apikey: apiKey,
    url,
    js_render: 'true',
    screenshot: 'true',
  });

  const requestUrl = `https://api.zenrows.com/v1/?${params.toString()}`;
  const responseBuffer = await httpsGet(requestUrl, 60000);
  const screenshot = responseBuffer.toString('base64');
  const timeMs = Date.now() - startTime;

  return {
    screenshot,
    provider: 'zenrows',
    timeMs,
    size: base64Size(screenshot),
  };
}
