import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// ---------------------------------------------------------------------------
// Mock AWS SDK clients (must use class syntax for `new` to work)
// ---------------------------------------------------------------------------
const mockS3Send = vi.fn().mockResolvedValue({});
const mockSqsSend = vi.fn().mockResolvedValue({
  Successful: [{ Id: 'msg-0-0' }],
  Failed: [],
});

vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: class {
      send = mockS3Send;
    },
    PutObjectCommand: class {
      constructor(public input: unknown) {}
    },
    GetObjectCommand: class {
      constructor(public input: unknown) {}
    },
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/signed-url'),
}));

vi.mock('@aws-sdk/client-sqs', () => {
  return {
    SQSClient: class {
      send = mockSqsSend;
    },
    SendMessageBatchCommand: class {
      constructor(public input: unknown) {}
    },
    SendMessageBatchResultEntry: class {},
    BatchResultErrorEntry: class {},
  };
});

vi.mock('@sparticuz/chromium', () => ({
  default: {
    args: [],
    headless: true,
    executablePath: vi.fn().mockResolvedValue('/usr/bin/chromium'),
  },
}));

vi.mock('puppeteer-core', () => ({
  default: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        setRequestInterception: vi.fn(),
        on: vi.fn(),
        goto: vi.fn(),
        screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
        close: vi.fn(),
      }),
      close: vi.fn(),
    }),
  },
}));

vi.mock('./orchestrator', () => ({
  orchestrate: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    body: null,
    headers: { Host: 'api.example.com' },
    multiValueHeaders: {},
    isBase64Encoded: false,
    path: '/screenshot-optimized',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      stage: 'dev',
      accountId: '123456789',
      apiId: 'abc123',
      authorizer: null,
      protocol: 'HTTP/1.1',
      httpMethod: 'POST',
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '127.0.0.1',
        user: null,
        userAgent: null,
        userArn: null,
      },
      path: '/dev/screenshot-optimized',
      requestId: 'test-request-id',
      requestTimeEpoch: Date.now(),
      resourceId: 'test',
      resourcePath: '/screenshot-optimized',
    },
    resource: '/screenshot-optimized',
    ...overrides,
  } as APIGatewayProxyEvent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockS3Send.mockResolvedValue({});
    mockSqsSend.mockResolvedValue({
      Successful: [{ Id: 'msg-0-0' }],
      Failed: [],
    });
  });

  describe('screenshotOptimized', () => {
    it('should return 200 for OPTIONS requests (CORS preflight)', async () => {
      const { screenshotOptimized } = await import('../handler');
      const event = makeEvent({ httpMethod: 'OPTIONS' });
      const result = await screenshotOptimized(event);
      expect(result.statusCode).toBe(200);
      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
    });

    it('should return 405 for GET requests', async () => {
      const { screenshotOptimized } = await import('../handler');
      const event = makeEvent({ httpMethod: 'GET' });
      const result = await screenshotOptimized(event);
      expect(result.statusCode).toBe(405);
    });

    it('should return 400 for invalid JSON body', async () => {
      const { screenshotOptimized } = await import('../handler');
      const event = makeEvent({ body: 'not json{{{' });
      const result = await screenshotOptimized(event);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('Invalid JSON');
    });

    it('should return 400 when urls field is missing', async () => {
      const { screenshotOptimized } = await import('../handler');
      const event = makeEvent({ body: JSON.stringify({}) });
      const result = await screenshotOptimized(event);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('urls field is required');
    });

    it('should return 400 when urls is an empty array', async () => {
      const { screenshotOptimized } = await import('../handler');
      const event = makeEvent({ body: JSON.stringify({ urls: [] }) });
      const result = await screenshotOptimized(event);
      expect(result.statusCode).toBe(400);
    });

    it('should accept a single URL string', async () => {
      const { screenshotOptimized } = await import('../handler');
      const event = makeEvent({
        body: JSON.stringify({ urls: 'https://example.com' }),
      });
      const result = await screenshotOptimized(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.batchId).toBeDefined();
      expect(body.jobs).toHaveLength(1);
      expect(body.jobs[0].url).toBe('https://example.com');
    });

    it('should accept an array of URLs', async () => {
      const { screenshotOptimized } = await import('../handler');
      const event = makeEvent({
        body: JSON.stringify({ urls: ['https://example.com', 'https://github.com'] }),
      });
      mockSqsSend.mockResolvedValue({
        Successful: [{ Id: 'msg-0-0' }, { Id: 'msg-0-1' }],
        Failed: [],
      });
      const result = await screenshotOptimized(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.jobs.length).toBe(2);
    });

    it('should mark invalid URLs in the response', async () => {
      const { screenshotOptimized } = await import('../handler');
      const event = makeEvent({
        body: JSON.stringify({ urls: ['not-a-url', 'https://example.com'] }),
      });
      const result = await screenshotOptimized(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      const invalidJob = body.jobs.find((j: { status: string }) => j.status === 'invalid_url');
      expect(invalidJob).toBeDefined();
      expect(invalidJob.url).toBe('not-a-url');
    });
  });

  describe('getResults', () => {
    it('should return 200 for OPTIONS requests', async () => {
      const { getResults } = await import('../handler');
      const event = makeEvent({
        httpMethod: 'OPTIONS',
        path: '/results',
      });
      const result = await getResults(event);
      expect(result.statusCode).toBe(200);
    });

    it('should return 405 for POST requests', async () => {
      const { getResults } = await import('../handler');
      const event = makeEvent({ httpMethod: 'POST', path: '/results' });
      const result = await getResults(event);
      expect(result.statusCode).toBe(405);
    });

    it('should return 400 when neither jobId nor batchId provided', async () => {
      const { getResults } = await import('../handler');
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/results',
        pathParameters: null,
        queryStringParameters: null,
      });
      const result = await getResults(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('apidocs', () => {
    it('should return API documentation', async () => {
      const { apidocs } = await import('../handler');
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/apidocs',
      });
      const result = await apidocs(event);
      expect(result.statusCode).toBe(200);
      expect(result.body).toContain('Screenshot Race API');
      expect(result.body).toContain('POST /screenshot-optimized');
    });

    it('should include the correct base URL from headers', async () => {
      const { apidocs } = await import('../handler');
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/apidocs',
        headers: { Host: 'my-api.execute-api.us-east-1.amazonaws.com' },
      });
      const result = await apidocs(event);
      expect(result.body).toContain('my-api.execute-api.us-east-1.amazonaws.com');
    });
  });

  describe('wakeup', () => {
    it('should return 200 for OPTIONS requests', async () => {
      const { wakeup } = await import('../handler');
      const event = makeEvent({ httpMethod: 'OPTIONS' });
      const result = await wakeup(event);
      expect(result.statusCode).toBe(200);
    });
  });
});
