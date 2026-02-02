import type { APIGatewayProxyEvent, APIGatewayProxyResult, SQSEvent } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand, SendMessageBatchCommand, SendMessageBatchResultEntry, BatchResultErrorEntry } from '@aws-sdk/client-sqs';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import crypto from 'crypto';

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
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

// =============================================================================
// SCREENSHOT HANDLER (Sync - Original Puppeteer-based)
// =============================================================================

interface ScreenshotRequest {
  url: string;
  fullPage?: boolean;
  width?: number;
  height?: number;
}

export async function screenshot(
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

  let request: ScreenshotRequest;
  try {
    request = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  if (!request.url) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'URL is required' }),
    };
  }

  try {
    new URL(request.url);
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid URL' }),
    };
  }

  let browser = null;

  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, ...OPTIMIZED_ARGS],
      defaultViewport: {
        width: request.width || 1280,
        height: request.height || 800,
      },
      executablePath: await getExecutablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // Set up request interception to block unnecessary resources
    await setupRequestInterception(page);

    await page.goto(request.url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    const screenshotData = await page.screenshot({
      type: 'webp',
      quality: 80,
      fullPage: request.fullPage || false,
      encoding: 'base64',
    });

    await browser.close();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        screenshot: screenshotData,
        url: request.url,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    if (browser) {
      await browser.close();
    }

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Screenshot failed',
        message: errorMessage,
      }),
    };
  }
}

// =============================================================================
// ASYNC SCREENSHOT HANDLER (Queues jobs to SQS)
// =============================================================================

interface AsyncScreenshotRequest {
  urls: string[];
}

interface JobMessage {
  jobId: string;
  batchId: string;
  url: string;
  createdAt: string;
}

export async function screenshotAsync(
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

  let request: AsyncScreenshotRequest;
  try {
    request = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  if (!request.urls || !Array.isArray(request.urls) || request.urls.length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'urls array is required' }),
    };
  }

  const batchId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  // Phase 1: Validate URLs and prepare job data
  const validJobs: { jobId: string; url: string; message: JobMessage }[] = [];
  const invalidJobs: { jobId: string; url: string; status: string }[] = [];

  for (const url of request.urls) {
    try {
      new URL(url);
      const jobId = crypto.randomUUID();
      const message: JobMessage = {
        jobId,
        batchId,
        url,
        createdAt,
      };
      validJobs.push({ jobId, url, message });
    } catch {
      invalidJobs.push({ jobId: '', url, status: 'invalid_url' });
    }
  }

  // Phase 2: Send SQS messages in batches (max 10 per batch) in parallel
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

        // Track successful and failed messages
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
            logger.error('SQS batch send failed for job', {
              batchId,
              jobId: job.jobId,
              url: job.url,
              error: errorMsg,
            });
            return { jobId: '', url: job.url, status: 'queue_failed' };
          }
        });
      } catch (error) {
        // Entire batch failed
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error('SQS batch failed entirely', {
          batchId,
          batchIndex,
          jobCount: batch.length,
          error: errorMessage,
          stack: errorStack,
        });
        return batch.map(job => ({
          jobId: '',
          url: job.url,
          status: 'queue_failed',
        }));
      }
    })
  );

  // Flatten results and separate successful from failed
  const sqsFlatResults = sqsResults.flat();
  const successfulJobs = sqsFlatResults.filter(j => j.status === 'queued');
  const failedJobs = sqsFlatResults.filter(j => j.status !== 'queued');

  // Phase 3: Write S3 job status files in parallel for successful jobs
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
          createdAt,
        }),
        ContentType: 'application/json',
      })).catch(error => {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.warn('Failed to write job status to S3', {
          batchId,
          jobId: job.jobId,
          url: job.url,
          error: errorMessage,
        });
        // Don't fail the whole operation if S3 write fails
        // The job is already queued in SQS
      })
    )
  );

  // Combine all jobs for response
  const jobs = [
    ...invalidJobs,
    ...successfulJobs.map(j => ({ jobId: j.jobId, url: j.url, status: j.status })),
    ...failedJobs.map(j => ({ jobId: j.jobId || '', url: j.url, status: j.status })),
  ];

  // Store batch info
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: `batches/${batchId}.json`,
    Body: JSON.stringify({
      batchId,
      jobs,
      totalUrls: request.urls.length,
      createdAt,
    }),
    ContentType: 'application/json',
  }));

  const queuedCount = jobs.filter(j => j.status === 'queued').length;
  const failedCount = jobs.filter(j => j.status !== 'queued').length;

  logger.info('Batch created', {
    batchId,
    totalUrls: request.urls.length,
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
      message: `Queued ${queuedCount} screenshot jobs`,
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

  try {
    for (const record of event.Records) {
      const message: JobMessage = JSON.parse(record.body);
      const { jobId, batchId, url } = message;
      const startTime = Date.now();

      logger.info('Processing job', { jobId, batchId, url });

      let page = null;

      try {
        // Create new page (cheap) instead of new browser (expensive)
        page = await browser.newPage();

        // Set up request interception to block unnecessary resources
        await setupRequestInterception(page);

        await page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: 30000,
        });

        const screenshotBuffer = await page.screenshot({
          type: 'webp',
          quality: 80,
          fullPage: false,
        });

        await page.close();
        page = null;

        const timeMs = Date.now() - startTime;
        const screenshotBase64 = screenshotBuffer.toString('base64');

        // Store result in S3
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `results/${jobId}.json`,
          Body: JSON.stringify({
            jobId,
            batchId,
            url,
            success: true,
            screenshot: screenshotBase64,
            size: screenshotBuffer.length,
            timeMs,
            completedAt: new Date().toISOString(),
          }),
          ContentType: 'application/json',
        }));

        // Update job status
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `jobs/${jobId}.json`,
          Body: JSON.stringify({
            jobId,
            batchId,
            url,
            status: 'completed',
            timeMs,
            completedAt: new Date().toISOString(),
          }),
          ContentType: 'application/json',
        }));

        logger.info('Job completed successfully', {
          jobId,
          batchId,
          url,
          timeMs,
          screenshotSizeBytes: screenshotBuffer.length,
        });
      } catch (error) {
        // Close page if it exists
        if (page) {
          try {
            await page.close();
          } catch {
            // Page may already be closed or browser crashed
          }
        }

        const timeMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorStack = error instanceof Error ? error.stack : undefined;

        logger.error('Job failed', {
          jobId,
          batchId,
          url,
          timeMs,
          error: errorMessage,
          stack: errorStack,
        });

        // Check if browser crashed and needs recovery
        const isBrowserCrash = errorMessage.includes('Target closed') ||
                               errorMessage.includes('Session closed') ||
                               errorMessage.includes('Protocol error') ||
                               errorMessage.includes('Browser disconnected');

        if (isBrowserCrash) {
          logger.warn('Browser crashed, attempting recovery', { jobId, batchId, url });
          try {
            await browser.close();
          } catch {
            // Browser already closed
          }
          // Relaunch browser for remaining records
          const recoveryStartTime = Date.now();
          browser = await puppeteer.launch({
            args: [...chromium.args, ...OPTIMIZED_ARGS],
            defaultViewport: {
              width: 1280,
              height: 800,
            },
            executablePath: await getExecutablePath(),
            headless: chromium.headless,
          });
          const recoveryTimeMs = Date.now() - recoveryStartTime;
          logger.info('Browser recovered successfully', { jobId, batchId, recoveryTimeMs });
        }

        // Store error result
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `results/${jobId}.json`,
          Body: JSON.stringify({
            jobId,
            batchId,
            url,
            success: false,
            error: errorMessage,
            timeMs,
            completedAt: new Date().toISOString(),
          }),
          ContentType: 'application/json',
        }));

        // Update job status
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `jobs/${jobId}.json`,
          Body: JSON.stringify({
            jobId,
            batchId,
            url,
            status: 'failed',
            error: errorMessage,
            timeMs,
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
      } catch (e) {
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

// Keep the old handler export for backwards compatibility
export { screenshot as handler };
