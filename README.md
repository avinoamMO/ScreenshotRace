# ScreenshotRace

**Race your screenshots across multiple providers. Keep the best one.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue?logo=typescript)](https://www.typescriptlang.org/)
[![AWS Lambda](https://img.shields.io/badge/AWS-Lambda-orange?logo=amazon-aws)](https://aws.amazon.com/lambda/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/github/actions/workflow/status/avinoamMO/ScreenshotRace/test.yml?label=tests)](https://github.com/avinoamMO/ScreenshotRace/actions)

---

## What Is This?

ScreenshotRace takes a URL, fires it at **4 screenshot providers simultaneously**, evaluates the results with **AI quality scoring**, and returns the best one. If a paywall is detected, it automatically attempts remediation with up to 4 bypass strategies.

**Why?** No single screenshot provider is reliable 100% of the time. Some choke on JavaScript-heavy sites, others get blocked by paywalls, and some just return blank pages. ScreenshotRace races them all and picks the winner.

### Key Features

- **Multi-provider racing** -- Puppeteer, Browserless, URLBox, and ZenRows run in parallel
- **AI quality evaluation** -- Claude analyzes each screenshot for errors, paywalls, and validity
- **Automatic paywall bypass** -- Detects login walls and attempts remediation (cookie injection, header spoofing, DOM interaction)
- **Composite scoring** -- Selects the best result based on AI verdict, image size, speed, and cost
- **Streaming preview** -- Returns a fast Puppeteer preview while the full race completes
- **S3 presigned URLs** -- No base64 in API responses; images served directly from S3
- **SQS job queue** -- Handles batch requests asynchronously with dead letter queue and retry logic

---

## Architecture

```
                            POST /screenshot-optimized
                                      |
                                      v
                          +------------------------+
                          |   API Gateway + Lambda  |
                          |   (screenshotOptimized) |
                          +------------------------+
                                      |
                          Validate URLs, create jobs
                          Generate presigned S3 URLs
                                      |
                                      v
                            +------------------+
                            |    SQS Queue     |
                            | (with DLQ, 3x    |
                            |  retry policy)   |
                            +------------------+
                                      |
                                      v
                          +------------------------+
                          |   screenshotWorker     |
                          |   (SQS-triggered)      |
                          +------------------------+
                                      |
                    Launch all providers in parallel
                                      |
              +------------+----------+-----------+------------+
              |            |          |           |            |
              v            v          v           v            |
         Puppeteer   Browserless  URLBox     ZenRows          |
         (Lambda)    (API)        (API)      (API)            |
              |            |          |           |            |
              +------------+----------+-----------+            |
                                      |                       |
                              Collect results                 |
                                      |                       |
                                      v                       |
                          +------------------------+          |
                          |   AI Quality Check     |          |
                          |   (Claude Sonnet)      |          |
                          +------------------------+          |
                                      |                       |
                          Score each screenshot               |
                          Select best result                  |
                                      |                       |
                           Paywall detected?                  |
                           /              \                   |
                         Yes               No                 |
                          |                 |                  |
                          v                 v                  |
                    Remediate         Write optimized          |
                    (up to 4x)       image to S3              |
                          |                 |                  |
                          v                 v                  |
                    +----------------------------------+      |
                    |          S3 Results Bucket        |      |
                    |  images/{jobId}/preview.webp      |      |
                    |  images/{jobId}/optimized.webp    |      |
                    |  results/{jobId}.json             |      |
                    +----------------------------------+      |
                                                              |
                          GET /results?batchId={id} <---------+
                                      |
                                      v
                              Poll until complete
                              Download via presigned URL
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- AWS account with configured credentials
- Serverless Framework v3

### 1. Clone and Install

```bash
git clone https://github.com/avinoamMO/ScreenshotRace.git
cd ScreenshotRace
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys
```

### 3. Deploy

```bash
npx serverless deploy --stage dev
```

### 4. Take a Screenshot

```bash
# Get your API key from the deploy output
API_KEY="your-api-key"
BASE_URL="https://your-api-id.execute-api.us-east-1.amazonaws.com/dev"

# Warm up Lambda (reduces cold start)
curl -H "x-api-key: $API_KEY" "$BASE_URL/wakeup"

# Take a screenshot
curl -X POST "$BASE_URL/screenshot-optimized" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"urls": "https://example.com"}'

# Poll for results (replace BATCH_ID from the response)
curl -H "x-api-key: $API_KEY" "$BASE_URL/results?batchId=BATCH_ID"
```

---

## API Reference

### `POST /screenshot-optimized`

Queue screenshots for one or more URLs. Returns immediately with job IDs and presigned S3 URLs.

**Headers:**
- `Content-Type: application/json`
- `x-api-key: <your-api-key>` (required)

**Request Body:**

```json
{ "urls": "https://example.com" }
```

or

```json
{ "urls": ["https://example.com", "https://github.com"] }
```

**Response (200):**

```json
{
  "batchId": "550e8400-e29b-41d4-a716-446655440000",
  "jobs": [
    {
      "jobId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      "url": "https://example.com",
      "status": "queued",
      "presignedUrls": {
        "preview": "https://s3...signed-url",
        "optimized": "https://s3...signed-url"
      }
    }
  ],
  "message": "Queued 1 optimized screenshot jobs"
}
```

### `GET /results?batchId={batchId}`

Poll for batch completion. Returns status and results for all jobs.

**Headers:**
- `x-api-key: <your-api-key>` (required)

**Response (complete):**

```json
{
  "batchId": "550e8400-e29b-41d4-a716-446655440000",
  "totalJobs": 1,
  "completed": 1,
  "pending": 0,
  "allComplete": true,
  "results": [
    {
      "jobId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      "url": "https://example.com",
      "phase": "optimized",
      "success": true,
      "optimized": {
        "provider": "puppeteer",
        "timeMs": 3100,
        "size": 52000,
        "quality": {
          "score": 9,
          "aiVerdict": "OK",
          "noPaywall": true,
          "noError": true
        },
        "attempts": [
          { "provider": "puppeteer", "score": 1012, "issue": null },
          { "provider": "browserless", "score": 1008, "issue": null }
        ]
      }
    }
  ]
}
```

### `GET /results/{jobId}`

Fetch results for a single job.

### `GET /wakeup`

Warms up the Lambda worker to reduce cold start latency. Launches and immediately closes a Chromium browser.

**Headers:**
- `x-api-key: <your-api-key>` (required)

### `GET /apidocs`

Returns full API documentation as plain text. No API key required.

---

## Providers

| Provider | Type | Speed | Paywall Bypass | Cost |
|----------|------|-------|----------------|------|
| **Puppeteer** | Lambda-native | Fast (2-4s) | Via remediation actions | Free (Lambda cost only) |
| **Browserless** | External API | Medium (3-6s) | Limited | Per-screenshot pricing |
| **URLBox** | External API | Medium (4-8s) | Limited | Per-screenshot pricing |
| **ZenRows** | External API | Slow (5-10s) | Built-in proxy rotation | Per-screenshot pricing |

Providers are launched in parallel. The orchestrator waits for all to complete, then uses AI to pick the best result.

---

## Scoring Algorithm

Each screenshot is scored on a composite scale:

| Factor | Points | Description |
|--------|--------|-------------|
| AI Quality | +1000 | Valid screenshot, no paywall, no error |
| AI Penalty (error) | -500 | Error page detected |
| AI Penalty (paywall) | -500 | Paywall/login wall detected |
| AI Penalty (invalid) | -300 | Invalid or empty screenshot |
| Image Size | 0-10 | Larger images get more points (more content) |
| Speed | 0-5 | Faster results get a slight bonus |
| Puppeteer Preference | +2 | Cheapest provider gets a tiebreaker bonus |

The attempt with the highest composite score wins.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for AI quality evaluation |
| `BROWSERLESS_API_KEY` | No | Browserless.io API key |
| `URLBOX_API_KEY` | No | URLBox API key |
| `URLBOX_API_SECRET` | No | URLBox API secret (used for HMAC signing) |
| `ZENROWS_API_KEY` | No | ZenRows API key |
| `RESULTS_BUCKET` | Auto | S3 bucket name (set by Serverless) |
| `JOBS_QUEUE_URL` | Auto | SQS queue URL (set by Serverless) |
| `AWS_REGION` | Auto | AWS region (defaults to us-east-1) |

At minimum, you need `ANTHROPIC_API_KEY` and at least one screenshot provider key. Puppeteer always runs as the baseline provider (no external key needed).

---

## Deployment

### Full Deployment

```bash
# Set environment variables
export ANTHROPIC_API_KEY="sk-ant-..."
export BROWSERLESS_API_KEY="..."
export URLBOX_API_KEY="..."
export URLBOX_API_SECRET="..."
export ZENROWS_API_KEY="..."

# Deploy to dev
npx serverless deploy --stage dev

# Deploy to production
npx serverless deploy --stage prod
```

### Infrastructure Created

- **S3 Bucket** -- `screenshot-race-lambda-results-{stage}` (1-day TTL)
- **SQS Queue** -- Job queue with DLQ (3 retries, 14-day DLQ retention)
- **Lambda Functions** -- 5 functions (API handler, worker, results, wakeup, apidocs)
- **API Gateway** -- REST API with API key authentication and usage plans
- **CloudWatch Alarms** -- Error rate, duration, throttle, and DLQ monitoring

---

## Performance

| Metric | Value |
|--------|-------|
| Cold start | 5-10s (first request) |
| Warm start | 2-4s (Puppeteer preview) |
| Full race | 5-15s (all providers + AI eval) |
| Remediation | +2-6s (if paywall detected) |
| Job submission (100 URLs) | <1s (batched SQS) |
| Max concurrent workers | 50 (configurable) |
| Image format | WebP (25-35% smaller than JPEG) |

---

## Integration Examples

### TypeScript / JavaScript

```typescript
const BASE = "https://your-api.execute-api.us-east-1.amazonaws.com/dev";
const HEADERS = { "Content-Type": "application/json", "x-api-key": "your-key" };

// Queue screenshots
const res = await fetch(`${BASE}/screenshot-optimized`, {
  method: "POST",
  headers: HEADERS,
  body: JSON.stringify({ urls: ["https://example.com"] }),
});
const { batchId, jobs } = await res.json();

// Poll until done
let done = false;
while (!done) {
  await new Promise(r => setTimeout(r, 2000));
  const poll = await fetch(`${BASE}/results?batchId=${batchId}`, { headers: HEADERS });
  const data = await poll.json();
  done = data.allComplete;
}

// Access images via presigned URLs
const imageUrl = jobs[0].presignedUrls.optimized;
```

### Python

```python
import requests, time

BASE = "https://your-api.execute-api.us-east-1.amazonaws.com/dev"
HEADERS = {"Content-Type": "application/json", "x-api-key": "your-key"}

res = requests.post(f"{BASE}/screenshot-optimized",
    headers=HEADERS,
    json={"urls": ["https://example.com"]})
data = res.json()
batch_id = data["batchId"]

while True:
    time.sleep(2)
    poll = requests.get(f"{BASE}/results?batchId={batch_id}", headers=HEADERS)
    if poll.json()["allComplete"]:
        break

# Download the optimized screenshot
img_url = data["jobs"][0]["presignedUrls"]["optimized"]
img = requests.get(img_url)
with open("screenshot.webp", "wb") as f:
    f.write(img.content)
```

---

## Development

### Run Tests

```bash
npm test
```

### Lint

```bash
npm run lint
```

### Format

```bash
npm run format
```

### Type Check

```bash
npm run typecheck
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Write tests for your changes
4. Ensure all tests pass (`npm test`)
5. Ensure linting passes (`npm run lint`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Code Style

- TypeScript strict mode
- ESLint + Prettier enforced
- JSDoc comments on all public functions
- Atomic commits with clear messages

---

## License

MIT License. See [LICENSE](LICENSE) for details.
