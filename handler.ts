import type { APIGatewayProxyEvent, APIGatewayProxyResult, SQSEvent } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SQSClient, SendMessageBatchCommand, SendMessageBatchResultEntry, BatchResultErrorEntry } from '@aws-sdk/client-sqs';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import crypto from 'crypto';
import { orchestrate } from './orchestrator';

// =============================================================================
// STRUCTURED LOGGING
// =============================================================================

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogContext {
  jobId?: string;
  batchId?: string;
  url?: string;
  provider?: string;
  timeMs?: number;
  error?: string;
  stack?: string;
  [key: string]: unknown;
}

function log(level: LogLevel, message: string, context: LogContext = {}): void {
  console.log(JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  }));
}

const logger = {
  debug: (msg: string, ctx?: LogContext) => log('DEBUG', msg, ctx),
  info: (msg: string, ctx?: LogContext) => log('INFO', msg, ctx),
  warn: (msg: string, ctx?: LogContext) => log('WARN', msg, ctx),
  error: (msg: string, ctx?: LogContext) => log('ERROR', msg, ctx),
};

// =============================================================================

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const BUCKET_NAME = process.env.RESULTS_BUCKET || 'screenshot-race-results';
const QUEUE_URL = process.env.JOBS_QUEUE_URL || '';

// Cache chromium executable path at module level to avoid async resolution each time
let cachedExecutablePath: string | null = null;

async function getExecutablePath(): Promise<string> {
  if (!cachedExecutablePath) {
    cachedExecutablePath = await chromium.executablePath();
  }
  return cachedExecutablePath;
}

// SQS batch limit is 10 messages per batch
const SQS_BATCH_SIZE = 10;

// Resource types to block for faster page loads
const BLOCKED_RESOURCE_TYPES = new Set([
  'font',
  'media',
  'websocket',
  'manifest',
]);

// Known tracking/analytics domains to block
const BLOCKED_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'facebook.net',
  'doubleclick.net',
  'hotjar.com',
  'segment.com',
  'mixpanel.com',
  'intercom.io',
  'crisp.chat',
  'newrelic.com',
  'sentry.io',
];

// Optimized browser args for faster launches
const OPTIMIZED_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-translate',
  '--mute-audio',
  '--no-first-run',
  '--hide-scrollbars',
];

import type { Page, HTTPRequest } from 'puppeteer-core';

/**
 * Sets up request interception to block unnecessary resources
 */
async function setupRequestInterception(page: Page): Promise<void> {
  await page.setRequestInterception(true);

  page.on('request', (request: HTTPRequest) => {
    const resourceType = request.resourceType();
    const url = request.url();

    // Block by resource type
    if (BLOCKED_RESOURCE_TYPES.has(resourceType)) {
      request.abort();
      return;
    }

    // Block known tracking/analytics domains
    if (BLOCKED_DOMAINS.some(domain => url.includes(domain))) {
      request.abort();
      return;
    }

    request.continue();
  });
}

type BrowserActionType =
  | 'click' | 'scroll' | 'type' | 'wait'
  | 'waitForSelector' | 'pressKey' | 'clearCookies' | 'setCookie';

interface BrowserAction {
  action: BrowserActionType;
  selector?: string;
  value?: string;
  x?: number;
  y?: number;
  delayMs?: number;
  cookie?: { name: string; value: string; domain?: string };
}

const ALLOWED_ACTIONS = new Set<BrowserActionType>([
  'click', 'scroll', 'type', 'wait', 'waitForSelector', 'pressKey', 'clearCookies', 'setCookie',
]);

const MAX_ACTIONS = 10;
const MAX_SINGLE_WAIT_MS = 5000;
const MAX_TOTAL_ACTION_TIME_MS = 15000;

async function executeActions(page: Page, actions: BrowserAction[]): Promise<void> {
  if (!actions || actions.length === 0) return;

  const safeActions = actions.slice(0, MAX_ACTIONS);
  const startTime = Date.now();

  for (const action of safeActions) {
    // Check total time budget
    if (Date.now() - startTime > MAX_TOTAL_ACTION_TIME_MS) {
      logger.warn('Action execution time budget exceeded', { elapsed: Date.now() - startTime });
      break;
    }

    // Skip unknown action types
    if (!ALLOWED_ACTIONS.has(action.action)) {
      logger.warn('Skipping unknown action type', { action: action.action });
      continue;
    }

    try {
      switch (action.action) {
        case 'click':
          if (action.selector) {
            await page.click(action.selector).catch(() => {});
          } else if (action.x != null && action.y != null) {
            await page.mouse.click(action.x, action.y).catch(() => {});
          }
          break;

        case 'scroll':
          await page.evaluate(
            (x: number, y: number) => { (globalThis as any).scrollBy(x, y); },
            action.x ?? 0,
            action.y ?? 300
          ).catch(() => {});
          break;

        case 'type':
          if (action.selector && action.value) {
            await page.type(action.selector, action.value).catch(() => {});
          }
          break;

        case 'wait': {
          const waitMs = Math.min(action.delayMs ?? 1000, MAX_SINGLE_WAIT_MS);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          break;
        }

        case 'waitForSelector':
          if (action.selector) {
            const timeout = Math.min(action.delayMs ?? 3000, MAX_SINGLE_WAIT_MS);
            await page.waitForSelector(action.selector, { timeout }).catch(() => {});
          }
          break;

        case 'pressKey':
          if (action.value) {
            await page.keyboard.press(action.value as any).catch(() => {});
          }
          break;

        case 'clearCookies': {
          const client = await page.createCDPSession();
          await client.send('Network.clearBrowserCookies').catch(() => {});
          await client.detach().catch(() => {});
          break;
        }

        case 'setCookie':
          if (action.cookie) {
            await page.setCookie({
              name: action.cookie.name,
              value: action.cookie.value,
              domain: action.cookie.domain || new URL(page.url()).hostname,
            }).catch(() => {});
          }
          break;
      }
    } catch {
      // Individual action failure - continue with remaining actions
    }
  }
}

/**
 * Chunks an array into smaller arrays of a specified size.
 * Used for SQS batch operations which have a limit of 10 messages.
 */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

// =============================================================================
// OPTIMIZED SCREENSHOT HANDLER (Queues jobs to SQS with orchestration mode)
// =============================================================================

interface JobMessage {
  jobId: string;
  batchId: string;
  url: string;
  createdAt: string;
}

interface OptimizedScreenshotRequest {
  urls: string | string[];
}

export async function screenshotOptimized(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  let request: OptimizedScreenshotRequest;
  try {
    request = JSON.parse(event.body || '{}');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to parse request body', { error: errorMessage, context: 'json_parse' });
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON body', context: 'json_parse' }),
    };
  }

  const rawUrls = request.urls;
  const urlList: string[] = typeof rawUrls === 'string' ? [rawUrls] : rawUrls;

  if (!urlList || !Array.isArray(urlList) || urlList.length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'urls field is required (string or array)', context: 'validation' }),
    };
  }

  logger.info('Screenshot optimized request received', { urlCount: urlList.length });

  const batchId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  // Validate URLs and prepare job data
  const validJobs: { jobId: string; url: string; message: JobMessage & { mode: string } }[] = [];
  const invalidJobs: { jobId: string; url: string; status: string }[] = [];

  for (const url of urlList) {
    try {
      new URL(url);
      const jobId = crypto.randomUUID();
      const message = {
        jobId,
        batchId,
        url,
        createdAt,
        mode: 'optimized',
      };
      validJobs.push({ jobId, url, message });
    } catch {
      invalidJobs.push({ jobId: '', url, status: 'invalid_url' });
    }
  }

  logger.info('URLs validated', { validCount: validJobs.length, invalidCount: invalidJobs.length });

  // Generate presigned URLs for each valid job
  const presignedUrlMap: Record<string, { preview: string; optimized: string }> = {};
  await Promise.all(
    validJobs.map(async (job) => {
      const [previewUrl, optimizedUrl] = await Promise.all([
        getSignedUrl(s3, new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `images/${job.jobId}/preview.webp`,
        }), { expiresIn: 3600 }),
        getSignedUrl(s3, new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `images/${job.jobId}/optimized.webp`,
        }), { expiresIn: 3600 }),
      ]);
      presignedUrlMap[job.jobId] = { preview: previewUrl, optimized: optimizedUrl };
    })
  );

  logger.info('Presigned URLs generated', { batchId, jobCount: validJobs.length });

  // Send SQS messages in batches (max 10 per batch) in parallel
  const sqsBatches = chunk(validJobs, SQS_BATCH_SIZE);
  const sqsResults = await Promise.all(
    sqsBatches.map(async (batch, batchIndex) => {
      try {
        const result = await sqs.send(new SendMessageBatchCommand({
          QueueUrl: QUEUE_URL,
          Entries: batch.map((job, idx) => ({
            Id: `msg-${batchIndex}-${idx}`,
            MessageBody: JSON.stringify(job.message),
          })),
        }));

        const successfulIds = new Set(
          (result.Successful || []).map((s: SendMessageBatchResultEntry) => s.Id)
        );
        const failedIds = new Map(
          (result.Failed || []).map((f: BatchResultErrorEntry) => [f.Id, f.Message])
        );

        return batch.map((job, idx) => {
          const msgId = `msg-${batchIndex}-${idx}`;
          if (successfulIds.has(msgId)) {
            return { ...job, status: 'queued' };
          } else {
            const errorMsg = failedIds.get(msgId) || 'Unknown error';
            logger.error('SQS batch send failed for optimized job', {
              batchId,
              jobId: job.jobId,
              url: job.url,
              error: errorMsg,
              context: 'sqs_send',
            });
            return { jobId: '', url: job.url, status: 'queue_failed' };
          }
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('SQS batch failed entirely (optimized)', {
          batchId,
          batchIndex,
          jobCount: batch.length,
          error: errorMessage,
          context: 'sqs_batch',
        });
        return batch.map(job => ({
          jobId: '',
          url: job.url,
          status: 'queue_failed',
        }));
      }
    })
  );

  const sqsFlatResults = sqsResults.flat();
  const successfulJobs = sqsFlatResults.filter(j => j.status === 'queued');
  const failedJobs = sqsFlatResults.filter(j => j.status !== 'queued');

  // Write S3 job status files in parallel for successful jobs
  await Promise.all(
    successfulJobs.map(job =>
      s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `jobs/${job.jobId}.json`,
        Body: JSON.stringify({
          jobId: job.jobId,
          batchId,
          url: job.url,
          status: 'queued',
          mode: 'optimized',
          createdAt,
        }),
        ContentType: 'application/json',
      })).catch(error => {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.warn('Failed to write optimized job status to S3', {
          batchId,
          jobId: job.jobId,
          url: job.url,
          error: errorMessage,
        });
      })
    )
  );

  const jobs = [
    ...invalidJobs.map(j => ({ ...j, presignedUrls: undefined })),
    ...successfulJobs.map(j => ({
      jobId: j.jobId,
      url: j.url,
      status: j.status,
      presignedUrls: presignedUrlMap[j.jobId],
    })),
    ...failedJobs.map(j => ({
      jobId: j.jobId || '',
      url: j.url,
      status: j.status,
      presignedUrls: undefined,
    })),
  ];

  // Store batch info
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: `batches/${batchId}.json`,
    Body: JSON.stringify({
      batchId,
      jobs,
      totalUrls: urlList.length,
      mode: 'optimized',
      createdAt,
    }),
    ContentType: 'application/json',
  }));

  const queuedCount = jobs.filter(j => j.status === 'queued').length;
  const failedCount = jobs.filter(j => j.status !== 'queued').length;

  logger.info('Optimized batch created', {
    batchId,
    totalUrls: urlList.length,
    queuedCount,
    failedCount,
    invalidUrls: invalidJobs.length,
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      batchId,
      jobs,
      message: `Queued ${queuedCount} optimized screenshot jobs`,
    }),
  };
}

// =============================================================================
// SCREENSHOT WORKER (Triggered by SQS, uses Puppeteer)
// =============================================================================

export async function screenshotWorker(event: SQSEvent): Promise<void> {
  const workerStartTime = Date.now();

  // Launch browser ONCE for all records in this invocation
  let browser = await puppeteer.launch({
    args: [...chromium.args, ...OPTIMIZED_ARGS],
    defaultViewport: {
      width: 1280,
      height: 800,
    },
    executablePath: await getExecutablePath(),
    headless: chromium.headless,
  });

  const browserLaunchTimeMs = Date.now() - workerStartTime;
  logger.info('Browser launched for SQS batch', {
    recordCount: event.Records.length,
    browserLaunchTimeMs,
  });

  /**
   * Helper: take a Puppeteer screenshot using the shared browser instance.
   */
  async function takePuppeteerScreenshot(
    targetUrl: string,
    options?: {
      actions?: unknown[];
      extraHeaders?: Record<string, string>;
      preCookies?: Array<{ name: string; value: string; domain: string }>;
    }
  ): Promise<{ screenshot: string; size: number; timeMs: number }> {
    const startTime = Date.now();
    let page = null;

    try {
      page = await browser.newPage();
      await setupRequestInterception(page);

      // Set extra HTTP headers if provided
      if (options?.extraHeaders && Object.keys(options.extraHeaders).length > 0) {
        await page.setExtraHTTPHeaders(options.extraHeaders);
      }

      // Set pre-navigation cookies if provided
      if (options?.preCookies && options.preCookies.length > 0) {
        await page.setCookie(
          ...options.preCookies.map(c => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
          }))
        );
      }

      await page.goto(targetUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // Execute browser actions if provided
      if (options?.actions && options.actions.length > 0) {
        await executeActions(page, options.actions as BrowserAction[]);
        await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
      }

      const screenshotBuffer = await page.screenshot({
        type: 'webp',
        quality: 80,
        fullPage: false,
      });

      await page.close();
      page = null;

      return {
        screenshot: screenshotBuffer.toString('base64'),
        size: screenshotBuffer.length,
        timeMs: Date.now() - startTime,
      };
    } catch (error) {
      if (page) {
        try { await page.close(); } catch { /* noop */ }
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Check if browser crashed and needs recovery
      const isBrowserCrash = errorMessage.includes('Target closed') ||
                             errorMessage.includes('Session closed') ||
                             errorMessage.includes('Protocol error') ||
                             errorMessage.includes('Browser disconnected');

      if (isBrowserCrash) {
        logger.warn('Browser crashed during screenshot, attempting recovery', { url: targetUrl });
        try { await browser.close(); } catch { /* noop */ }
        const recoveryStartTime = Date.now();
        browser = await puppeteer.launch({
          args: [...chromium.args, ...OPTIMIZED_ARGS],
          defaultViewport: { width: 1280, height: 800 },
          executablePath: await getExecutablePath(),
          headless: chromium.headless,
        });
        logger.info('Browser recovered', { recoveryTimeMs: Date.now() - recoveryStartTime });
      }

      throw error;
    }
  }

  try {
    for (const record of event.Records) {
      const message = JSON.parse(record.body) as JobMessage & { mode?: string };
      const { jobId, batchId, url } = message;

      logger.info('Processing job', { jobId, batchId, url });

      try {
        await orchestrate(url, jobId, batchId, takePuppeteerScreenshot);
        logger.info('Job orchestration completed', { jobId, batchId, url });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Orchestration failed for job', { jobId, batchId, url, error: errorMessage });

        // Store error result
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `results/${jobId}.json`,
          Body: JSON.stringify({
            jobId, batchId, url,
            phase: 'optimized',
            success: false,
            error: errorMessage,
            completedAt: new Date().toISOString(),
          }),
          ContentType: 'application/json',
        }));

        await s3.send(new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `jobs/${jobId}.json`,
          Body: JSON.stringify({
            jobId, batchId, url,
            status: 'failed',
            error: errorMessage,
            completedAt: new Date().toISOString(),
          }),
          ContentType: 'application/json',
        }));
      }
    }
  } finally {
    // Always close browser when done with all records
    try {
      await browser.close();
      const totalWorkerTimeMs = Date.now() - workerStartTime;
      logger.info('Worker batch completed', {
        recordCount: event.Records.length,
        totalWorkerTimeMs,
      });
    } catch {
      // Browser may already be closed
    }
  }
}

// =============================================================================
// RESULTS HANDLER (Fetch results by jobId or batchId)
// =============================================================================

export async function getResults(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const jobId = event.pathParameters?.renderId; // Using renderId for backwards compat
  const batchId = event.queryStringParameters?.batchId;

  if (!jobId && !batchId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'jobId or batchId is required' }),
    };
  }

  try {
    if (jobId && jobId !== 'undefined') {
      // Fetch single result
      try {
        const response = await s3.send(new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `results/${jobId}.json`,
        }));

        const body = await response.Body?.transformToString();

        if (body) {
          return {
            statusCode: 200,
            headers,
            body,
          };
        }
      } catch {
        // Result not ready yet, check job status
        try {
          const jobResponse = await s3.send(new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: `jobs/${jobId}.json`,
          }));
          const jobBody = await jobResponse.Body?.transformToString();
          if (jobBody) {
            return {
              statusCode: 200,
              headers,
              body: jobBody,
            };
          }
        } catch {
          // Job not found
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ jobId, status: 'pending' }),
      };
    }

    if (batchId) {
      // Fetch batch info
      const batchResponse = await s3.send(new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `batches/${batchId}.json`,
      }));

      const batchBody = await batchResponse.Body?.transformToString();

      if (!batchBody) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Batch not found' }),
        };
      }

      const batch = JSON.parse(batchBody) as { jobs: { jobId: string; url: string }[] };

      // Fetch all results for this batch
      const results = await Promise.all(
        batch.jobs
          .filter(job => job.jobId)
          .map(async (job) => {
            try {
              const resultResponse = await s3.send(new GetObjectCommand({
                Bucket: BUCKET_NAME,
                Key: `results/${job.jobId}.json`,
              }));
              const resultBody = await resultResponse.Body?.transformToString();
              return resultBody ? JSON.parse(resultBody) : { jobId: job.jobId, url: job.url, status: 'pending' };
            } catch {
              // Check job status
              try {
                const jobResponse = await s3.send(new GetObjectCommand({
                  Bucket: BUCKET_NAME,
                  Key: `jobs/${job.jobId}.json`,
                }));
                const jobBody = await jobResponse.Body?.transformToString();
                return jobBody ? JSON.parse(jobBody) : { jobId: job.jobId, url: job.url, status: 'pending' };
              } catch {
                return { jobId: job.jobId, url: job.url, status: 'pending' };
              }
            }
          })
      );

      const completed = results.filter(r => r.success !== undefined).length;
      const pending = results.filter(r => r.success === undefined).length;

      logger.info('Batch results fetched', {
        batchId,
        totalJobs: batch.jobs.length,
        completed,
        pending,
        allComplete: pending === 0,
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          batchId,
          totalJobs: batch.jobs.length,
          completed,
          pending,
          allComplete: pending === 0,
          results,
        }),
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid request' }),
    };
  } catch (error) {
    if ((error as { name?: string }).name === 'NoSuchKey') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: 'pending' }),
      };
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('Error fetching results', {
      jobId: jobId || undefined,
      batchId: batchId || undefined,
      error: errorMessage,
      stack: errorStack,
    });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch results' }),
    };
  }
}

// =============================================================================
// WAKEUP HANDLER (Warm up Lambda by launching and closing browser)
// =============================================================================

// =============================================================================
// API DOCS (Public, no API key required)
// =============================================================================

export async function apidocs(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const stage = event.requestContext.stage;
  const host = event.headers.Host || event.headers.host || '';
  const base = `https://${host}/${stage}`;

  const docs = `# Screenshot Race API

Base URL: ${base}

All endpoints except /apidocs require the header:
  x-api-key: <your-api-key>

---

## GET /wakeup

Warms up the Lambda (reduces cold start for subsequent calls).

Response:
  {"status": "warm"}

---

## POST /screenshot-optimized

Takes screenshots of one or more URLs using multiple providers in parallel,
selects the best result via AI quality evaluation, and handles paywall bypass.

Returns immediately with job IDs and presigned S3 URLs for the images.
Poll /results to track progress.

Request body:
  {"urls": "https://example.com"}
  {"urls": ["https://example.com", "https://github.com"]}

Response:
  {
    "batchId": "uuid",
    "jobs": [
      {
        "jobId": "uuid",
        "url": "https://example.com",
        "status": "queued",
        "presignedUrls": {
          "preview": "https://s3...signed-url (available after ~3s)",
          "optimized": "https://s3...signed-url (available when job completes)"
        }
      }
    ],
    "message": "Queued 1 optimized screenshot jobs"
  }

---

## GET /results?batchId={batchId}

Poll for all jobs in a batch.

Response (in progress):
  {
    "batchId": "uuid",
    "totalJobs": 1,
    "completed": 0,
    "pending": 1,
    "allComplete": false,
    "results": [
      {
        "jobId": "uuid",
        "url": "https://example.com",
        "phase": "preview",
        "success": true,
        "preview": {"provider": "puppeteer", "timeMs": 2300, "size": 45000}
      }
    ]
  }

Response (complete):
  {
    "batchId": "uuid",
    "totalJobs": 1,
    "completed": 1,
    "pending": 0,
    "allComplete": true,
    "results": [
      {
        "jobId": "uuid",
        "url": "https://example.com",
        "phase": "optimized",
        "success": true,
        "timedOut": false,
        "optimized": {
          "provider": "puppeteer",
          "timeMs": 3100,
          "size": 52000,
          "quality": {"score": 9, "aiVerdict": "OK", "noPaywall": true, "noError": true},
          "attempts": [{"provider": "puppeteer", "score": 1012, "issue": null}]
        }
      }
    ]
  }

## GET /results/{jobId}

Poll for a single job by its jobId.

---

## Integration Example (TypeScript)

\`\`\`typescript
const BASE = "${base}";
const API_KEY = "your-api-key";
const HEADERS = { "Content-Type": "application/json", "x-api-key": API_KEY };

// 1. Warm up
await fetch(\`\${BASE}/wakeup\`, { headers: HEADERS });

// 2. Queue screenshots
const res = await fetch(\`\${BASE}/screenshot-optimized\`, {
  method: "POST",
  headers: HEADERS,
  body: JSON.stringify({ urls: ["https://example.com"] }),
});
const { batchId, jobs } = await res.json();
const previewUrl = jobs[0].presignedUrls.preview;
const optimizedUrl = jobs[0].presignedUrls.optimized;

// 3. Poll until done
let done = false;
while (!done) {
  await new Promise(r => setTimeout(r, 2000));
  const poll = await fetch(\`\${BASE}/results?batchId=\${batchId}\`, { headers: HEADERS });
  const data = await poll.json();
  done = data.allComplete;
}

// 4. Load image directly from S3
// optimizedUrl is now a valid image URL (presigned, expires in 1h)
\`\`\`

## Integration Example (Python)

\`\`\`python
import requests, time

BASE = "${base}"
HEADERS = {"Content-Type": "application/json", "x-api-key": "your-api-key"}

# 1. Warm up
requests.get(f"{BASE}/wakeup", headers=HEADERS)

# 2. Queue screenshots
res = requests.post(f"{BASE}/screenshot-optimized",
    headers=HEADERS,
    json={"urls": ["https://example.com"]})
data = res.json()
batch_id = data["batchId"]
preview_url = data["jobs"][0]["presignedUrls"]["preview"]
optimized_url = data["jobs"][0]["presignedUrls"]["optimized"]

# 3. Poll until done
while True:
    time.sleep(2)
    poll = requests.get(f"{BASE}/results?batchId={batch_id}", headers=HEADERS)
    if poll.json()["allComplete"]:
        break

# 4. Download the image
img = requests.get(optimized_url)
with open("screenshot.webp", "wb") as f:
    f.write(img.content)
\`\`\`

## Integration Example (curl)

\`\`\`bash
# Warm up
curl -H "x-api-key: YOUR_KEY" ${base}/wakeup

# Queue
curl -X POST -H "Content-Type: application/json" -H "x-api-key: YOUR_KEY" \\
  -d '{"urls":"https://example.com"}' ${base}/screenshot-optimized

# Poll (replace BATCH_ID)
curl -H "x-api-key: YOUR_KEY" "${base}/results?batchId=BATCH_ID"
\`\`\`
`;

  return {
    statusCode: 200,
    headers: {
      ...headers,
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body: docs,
  };
}

// =============================================================================
// WAKEUP HANDLER
// =============================================================================

export async function wakeup(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  logger.info('Wakeup request received');

  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, ...OPTIMIZED_ARGS],
      defaultViewport: { width: 1280, height: 800 },
      executablePath: await getExecutablePath(),
      headless: chromium.headless,
    });

    await browser.close();
    browser = null;

    logger.info('Wakeup complete - browser launched and closed successfully');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ status: 'warm' }),
    };
  } catch (error) {
    if (browser) {
      try { await browser.close(); } catch { /* noop */ }
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Wakeup failed', { error: errorMessage });

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Wakeup failed', message: errorMessage }),
    };
  }
}
