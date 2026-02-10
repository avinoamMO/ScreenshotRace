# screenshot-race-sdk

TypeScript SDK for the [ScreenshotRace](https://github.com/avinoamMO/ScreenshotRace) API.

## Installation

```bash
npm install screenshot-race-sdk
```

## Quick Start

```typescript
import { ScreenshotRace } from 'screenshot-race-sdk';

const client = new ScreenshotRace({
  apiKey: 'your-api-key',
  baseUrl: 'https://your-api.execute-api.us-east-1.amazonaws.com/dev',
});

// Simple: capture a single URL and wait for the result
const result = await client.capture('https://example.com');
console.log(result.optimized?.provider);       // "puppeteer"
console.log(result.optimized?.quality.score);   // 9
console.log(result.presignedUrls.optimized);    // S3 presigned URL
```

## API

### Constructor

```typescript
new ScreenshotRace({
  apiKey: string;          // Required: your API key
  baseUrl: string;         // Required: deployed API base URL
  pollIntervalMs?: number; // Optional: polling interval (default: 2000)
  timeoutMs?: number;      // Optional: max wait time (default: 60000)
})
```

### Methods

#### `capture(url: string): Promise<CaptureResult>`

High-level method. Submits a URL, polls until complete, returns the result.

```typescript
const result = await client.capture('https://example.com');
```

#### `captureMany(urls: string[]): Promise<CaptureResult[]>`

Capture multiple URLs in a single batch.

```typescript
const results = await client.captureMany([
  'https://example.com',
  'https://github.com',
]);
```

#### `warmup(): Promise<void>`

Warm up the Lambda to reduce cold start latency.

```typescript
await client.warmup();
```

#### `submit(urls: string | string[]): Promise<SubmitResponse>`

Low-level: submit URLs without waiting for results.

```typescript
const { batchId, jobs } = await client.submit(['https://example.com']);
```

#### `getResults(batchId: string): Promise<BatchResults>`

Low-level: poll for batch results.

```typescript
const results = await client.getResults(batchId);
if (results.allComplete) {
  // All done
}
```

#### `getJobResult(jobId: string): Promise<JobResult>`

Low-level: get results for a single job.

## Error Handling

```typescript
import { ScreenshotRaceError } from 'screenshot-race-sdk';

try {
  const result = await client.capture('https://example.com');
} catch (error) {
  if (error instanceof ScreenshotRaceError) {
    console.error(error.statusCode); // 408 for timeout
    console.error(error.message);
  }
}
```

## License

MIT
