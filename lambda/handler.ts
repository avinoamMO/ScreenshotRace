import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

interface ScreenshotRequest {
  url: string;
  fullPage?: boolean;
  width?: number;
  height?: number;
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
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

  // Validate URL
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

    // Set a reasonable timeout
    await page.goto(request.url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Take screenshot
    const screenshot = await page.screenshot({
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
        screenshot,
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
