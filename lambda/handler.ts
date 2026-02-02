import type { APIGatewayProxyEvent, APIGatewayProxyResult, SQSEvent } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import crypto from 'crypto';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const BUCKET_NAME = process.env.RESULTS_BUCKET || 'screenshot-race-results';
const QUEUE_URL = process.env.JOBS_QUEUE_URL || '';

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
      args: chromium.args,
      defaultViewport: {
        width: request.width || 1280,
        height: request.height || 800,
      },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    await page.goto(request.url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    const screenshotData = await page.screenshot({
      type: 'jpeg',
      quality: 85,
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
  const jobs: { jobId: string; url: string; status: string }[] = [];
  const createdAt = new Date().toISOString();

  // Queue each URL as a separate job
  for (const url of request.urls) {
    // Validate URL
    try {
      new URL(url);
    } catch {
      jobs.push({ jobId: '', url, status: 'invalid_url' });
      continue;
    }

    const jobId = crypto.randomUUID();

    const message: JobMessage = {
      jobId,
      batchId,
      url,
      createdAt,
    };

    try {
      await sqs.send(new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify(message),
      }));

      jobs.push({ jobId, url, status: 'queued' });

      // Store initial job status in S3
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `jobs/${jobId}.json`,
        Body: JSON.stringify({
          jobId,
          batchId,
          url,
          status: 'queued',
          createdAt,
        }),
        ContentType: 'application/json',
      }));
    } catch (error) {
      console.error(`Error queueing job for ${url}:`, error);
      jobs.push({ jobId: '', url, status: 'queue_failed' });
    }
  }

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

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      batchId,
      jobs,
      message: `Queued ${jobs.filter(j => j.status === 'queued').length} screenshot jobs`,
    }),
  };
}

// =============================================================================
// SCREENSHOT WORKER (Triggered by SQS, uses Puppeteer)
// =============================================================================

export async function screenshotWorker(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    const message: JobMessage = JSON.parse(record.body);
    const { jobId, batchId, url } = message;
    const startTime = Date.now();

    console.log(`Processing job ${jobId} for URL: ${url}`);

    let browser = null;

    try {
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: {
          width: 1280,
          height: 800,
        },
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });

      const page = await browser.newPage();

      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      const screenshotBuffer = await page.screenshot({
        type: 'jpeg',
        quality: 85,
        fullPage: false,
      });

      await browser.close();
      browser = null;

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

      console.log(`Job ${jobId} completed in ${timeMs}ms`);
    } catch (error) {
      if (browser) {
        await browser.close();
      }

      const timeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      console.error(`Job ${jobId} failed:`, errorMessage);

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

    console.error('Error fetching results:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch results' }),
    };
  }
}

// Keep the old handler export for backwards compatibility
export { screenshot as handler };
