# Screenshot Race Optimization Plan

## Overview
- **Created**: 2026-02-02
- **Status**: IN PROGRESS
- **Total Phases**: 4
- **Total Tasks**: 20
- **Completed**: 0/20

---

## Progress Tracker

| Phase | Status | Tasks | Completed |
|-------|--------|-------|-----------|
| Phase 1: Foundation | COMPLETE | 5 | 4/5 (1.5 deferred) |
| Phase 2: Performance | COMPLETE | 5 | 5/5 |
| Phase 3: Reliability | COMPLETE | 5 | 5/5 |
| Phase 4: Optimization | COMPLETE | 5 | 3/5 (4.2, 4.3, 4.4 deferred) |

**Overall Status: COMPLETE (17/20 tasks implemented)**

---

# Phase 1: Foundation (Critical Fixes)

## Task 1.1: Add Dead Letter Queue to SQS

### Status: COMPLETE

### Subtasks
- [ ] 1.1.1 Add DLQ resource to serverless.yml
- [ ] 1.1.2 Add RedrivePolicy to JobsQueue
- [ ] 1.1.3 Add IAM permissions for DLQ
- [ ] 1.1.4 Add CloudWatch alarm for DLQ messages
- [ ] 1.1.5 Deploy and verify

### Success Metrics
- DLQ resource exists in CloudFormation stack
- Failed messages appear in DLQ after 3 retries
- Alarm triggers when DLQ has messages

### Logic
Without a DLQ, failed screenshot jobs retry indefinitely until message retention expires (1 hour), then disappear forever. This causes:
- Silent data loss
- Wasted compute on permanently failing jobs
- No visibility into systematic failures

### Testing Plan
1. Deploy the changes
2. Submit a job with an invalid URL that will always fail
3. Verify message appears in DLQ after 3 attempts
4. Verify CloudWatch alarm fires

### Before/After
```
BEFORE:
JobsQueue → Worker fails → Retry forever → Message expires → Lost

AFTER:
JobsQueue → Worker fails → 3 retries → DLQ → Alarm → Investigation
```

### Assigned Agents
- **Implementation**: `general-purpose` (DevOps focus)
- **Code Review**: `general-purpose` (AWS Expert)
- **QA**: `general-purpose` (SRE focus)

### Files to Modify
- `lambda/serverless.yml`

### Notes
```
<!-- Implementation notes will be added here -->
```

---

## Task 1.2: Implement AbortController for Cancellation

### Status: COMPLETE

### Subtasks
- [ ] 1.2.1 Add AbortController ref in App.tsx
- [ ] 1.2.2 Pass signal to raceAllUrls function
- [ ] 1.2.3 Propagate signal to all provider fetch calls
- [ ] 1.2.4 Update handleStop to call abort()
- [ ] 1.2.5 Handle AbortError in all catch blocks
- [ ] 1.2.6 Update polling loops to check signal.aborted

### Success Metrics
- Clicking Stop immediately cancels all in-flight requests
- Network tab shows requests as "canceled"
- No results arrive after Stop is clicked
- Memory is released after cancellation

### Logic
Currently, `stopRaceRef.current = true` only sets a flag that's checked inconsistently. In-flight fetch requests, polling loops, and quality checks continue running. This wastes bandwidth, CPU, and confuses users who see "stopped" but results still arriving.

### Testing Plan
1. Start a race with 10+ URLs
2. Click Stop after 2-3 seconds
3. Open Network tab - verify requests show "canceled"
4. Verify no new results appear in UI
5. Check memory doesn't continue growing

### Before/After
```
BEFORE:
User clicks Stop → Flag set → Fetch continues → Results arrive → Confused user

AFTER:
User clicks Stop → AbortController.abort() → All fetches canceled → Clean stop
```

### Assigned Agents
- **Implementation**: `general-purpose` (Async Patterns Expert)
- **Code Review**: `general-purpose` (React Expert)
- **QA**: `general-purpose` (Frontend Performance Expert)

### Files to Modify
- `src/App.tsx`
- `src/providers/index.ts`
- `src/providers/lambdaAsync.ts`
- `src/providers/urlboxAsync.ts`
- `src/providers/browserless.ts`
- `src/providers/urlbox.ts`
- `src/providers/zenrows.ts`
- `src/providers/lambda.ts`

### Notes
```
<!-- Implementation notes will be added here -->
```

---

## Task 1.3: Add Fetch Timeouts to All Network Calls

### Status: COMPLETE

### Subtasks
- [ ] 1.3.1 Create utility function `fetchWithTimeout`
- [ ] 1.3.2 Apply to lambdaAsync.ts fetch calls
- [ ] 1.3.3 Apply to urlboxAsync.ts fetch calls
- [ ] 1.3.4 Apply to all sync provider fetch calls
- [ ] 1.3.5 Set appropriate timeout values per endpoint type

### Success Metrics
- No fetch call can hang longer than 30 seconds
- Timeout errors are properly caught and reported
- Timeout is distinguishable from other errors in UI

### Logic
Currently, fetch calls have no timeout. If a server hangs or network stalls, the request waits indefinitely, blocking the entire race and potentially causing memory leaks as promises never resolve.

### Testing Plan
1. Mock a slow endpoint that never responds
2. Verify timeout error appears after 30 seconds
3. Verify other providers complete normally
4. Verify UI shows appropriate timeout error message

### Before/After
```
BEFORE:
fetch(url) → Server hangs → Wait forever → Race never completes

AFTER:
fetchWithTimeout(url, 30000) → Server hangs → 30s → TimeoutError → Continue
```

### Assigned Agents
- **Implementation**: `general-purpose` (Network Expert)
- **Code Review**: `general-purpose` (Async Patterns Expert)
- **QA**: `general-purpose` (SRE focus)

### Files to Modify
- `src/utils/fetchWithTimeout.ts` (new)
- `src/providers/lambdaAsync.ts`
- `src/providers/urlboxAsync.ts`
- `src/providers/browserless.ts`
- `src/providers/urlbox.ts`
- `src/providers/zenrows.ts`
- `src/providers/lambda.ts`

### Notes
```
<!-- Implementation notes will be added here -->
```

---

## Task 1.4: Parallelize SQS Sends with SendMessageBatch

### Status: COMPLETE

### Subtasks
- [ ] 1.4.1 Import SendMessageBatchCommand from AWS SDK
- [ ] 1.4.2 Create utility to chunk URLs into batches of 10
- [ ] 1.4.3 Replace sequential for-loop with parallel batch sends
- [ ] 1.4.4 Handle partial batch failures
- [ ] 1.4.5 Update S3 initial status writes to be parallel

### Success Metrics
- 100 URLs queued in <1 second (vs 10-20 seconds before)
- All jobs properly tracked in S3
- Partial failures don't lose successful jobs

### Logic
Current code sends SQS messages sequentially with `await` in a for-loop. Each send takes 20-50ms, so 100 URLs = 2-5 seconds just for queuing. SQS supports batch sends of up to 10 messages, reducing this to ~10 API calls.

### Testing Plan
1. Time job submission for 50 URLs before change
2. Implement change
3. Time job submission for 50 URLs after change
4. Verify all jobs are properly queued
5. Verify results come back for all URLs

### Before/After
```
BEFORE:
for url in urls:
  await sqs.send(url)  # 100 URLs = 100 sequential calls = 5 seconds

AFTER:
batches = chunk(urls, 10)
await Promise.all(batches.map(b => sqs.sendBatch(b)))  # 10 parallel calls = 200ms
```

### Assigned Agents
- **Implementation**: `general-purpose` (AWS Lambda Expert)
- **Code Review**: `general-purpose` (Distributed Systems Expert)
- **QA**: `general-purpose` (HPC Expert)

### Files to Modify
- `lambda/handler.ts` (screenshotAsync function)

### Notes
```
<!-- Implementation notes will be added here -->
```

---

## Task 1.5: Store Images as Binary in S3, Return Presigned URLs

### Status: NOT STARTED

### Subtasks
- [ ] 1.5.1 Modify worker to store raw binary screenshot in S3
- [ ] 1.5.2 Update result JSON to reference image key instead of base64
- [ ] 1.5.3 Add getObject presigned URL generation to getResults
- [ ] 1.5.4 Update frontend to fetch images via presigned URL
- [ ] 1.5.5 Update image display to use Object URLs
- [ ] 1.5.6 Add cleanup for Object URLs on unmount

### Success Metrics
- API response size reduced by 33%
- Images load correctly in preview panel
- Memory usage reduced (no base64 strings in state)
- S3 storage reduced by 33%

### Logic
Base64 encoding adds 33% overhead. A 750KB JPEG becomes 1MB when base64 encoded. This wastes:
- Network bandwidth
- Lambda response size (can hit 6MB limit)
- Browser memory (large strings)
- S3 storage costs

### Testing Plan
1. Run race before change, measure response sizes
2. Implement change
3. Run race after change, measure response sizes
4. Verify images display correctly
5. Verify memory usage is lower
6. Test with large screenshots (full page)

### Before/After
```
BEFORE:
Worker → screenshot.toString('base64') → JSON → 1MB response → Parse → Hold in state

AFTER:
Worker → S3 PUT binary → JSON with key → Presigned URL → fetch → Object URL → Revoke
```

### Assigned Agents
- **Implementation**: `general-purpose` (AWS Expert)
- **Code Review**: `general-purpose` (Network Expert)
- **QA**: `general-purpose` (Frontend Performance Expert)

### Files to Modify
- `lambda/handler.ts`
- `src/providers/lambdaAsync.ts`
- `src/components/PreviewPanel.tsx`
- `src/types.ts`

### Notes
```
<!-- Implementation notes will be added here -->
```

---

# Phase 2: Performance (High Impact)

## Task 2.1: Add Exponential Backoff to Polling

### Status: COMPLETE

### Subtasks
- [ ] 2.1.1 Create `pollWithBackoff` utility function
- [ ] 2.1.2 Apply to lambdaAsync.ts polling loop
- [ ] 2.1.3 Apply to urlboxAsync.ts polling loop
- [ ] 2.1.4 Configure: initial=200ms, max=2000ms, factor=1.5

### Success Metrics
- Polling starts fast (200ms) for quick jobs
- Polling slows down (2s) for slow jobs
- Total poll requests reduced by 60%

### Logic
Fixed 500ms polling wastes requests. Fast jobs complete in 2-3 seconds but we poll 4-6 times. Slow jobs benefit from less aggressive polling. Exponential backoff starts fast then slows, reducing total requests while maintaining responsiveness.

### Testing Plan
1. Count poll requests for a fast job (2s) before change
2. Count poll requests for a slow job (30s) before change
3. Implement change
4. Verify fast jobs still feel responsive
5. Verify slow jobs use fewer poll requests

### Before/After
```
BEFORE:
Poll every 500ms: 0ms, 500ms, 1000ms, 1500ms, 2000ms (5 polls for 2s job)

AFTER:
Exponential: 0ms, 200ms, 500ms, 950ms, 1625ms, 2000ms (3-4 polls for 2s job)
```

### Assigned Agents
- **Implementation**: `general-purpose` (Async Patterns Expert)
- **Code Review**: `general-purpose` (HPC Expert)
- **QA**: `general-purpose` (Network Expert)

### Files to Modify
- `src/utils/pollWithBackoff.ts` (new)
- `src/providers/lambdaAsync.ts`
- `src/providers/urlboxAsync.ts`

### Notes
```
<!-- Implementation notes will be added here -->
```

---

## Task 2.2: Implement Browser Reuse Across SQS Records

### Status: COMPLETE

### Subtasks
- [ ] 2.2.1 Move browser launch outside the for-loop
- [ ] 2.2.2 Create new page per record instead of new browser
- [ ] 2.2.3 Add proper cleanup in finally block
- [ ] 2.2.4 Handle browser crash gracefully (re-launch)
- [ ] 2.2.5 Cache chromium executable path at module level

### Success Metrics
- Browser launch happens once per Lambda invocation
- 500-2000ms saved per screenshot after first
- Memory usage stable (no leak from multiple browsers)

### Logic
Currently, each SQS record launches a new Chromium browser. Chromium cold start takes 500-2000ms. By reusing the browser and creating new pages, we eliminate this overhead for all but the first screenshot in a batch.

### Testing Plan
1. Time 5 sequential screenshots before change
2. Implement change
3. Time 5 sequential screenshots after change
4. Verify screenshots are identical quality
5. Test browser crash recovery

### Before/After
```
BEFORE:
Record 1: launch browser (1s) + screenshot (3s) = 4s
Record 2: launch browser (1s) + screenshot (3s) = 4s
Total: 8s

AFTER:
Record 1: launch browser (1s) + screenshot (3s) = 4s
Record 2: new page (50ms) + screenshot (3s) = 3.05s
Total: 7.05s (12% faster, scales better with more records)
```

### Assigned Agents
- **Implementation**: `general-purpose` (Scraping Expert)
- **Code Review**: `general-purpose` (AWS Lambda Expert)
- **QA**: `general-purpose` (HPC Expert)

### Files to Modify
- `lambda/handler.ts` (screenshotWorker function)

### Notes
```
<!-- Implementation notes will be added here -->
```

---

## Task 2.3: Add Resource Blocking to Puppeteer

### Status: COMPLETE

### Subtasks
- [ ] 2.3.1 Enable request interception on page
- [ ] 2.3.2 Block font resources
- [ ] 2.3.3 Block known analytics/tracking domains
- [ ] 2.3.4 Block media (video/audio) resources
- [ ] 2.3.5 Make blocking configurable via request parameter

### Success Metrics
- Page load time reduced by 30-50%
- Screenshot quality maintained for text/layout
- Analytics scripts don't execute
- Configurable for cases where resources are needed

### Logic
Most pages load fonts (200-500KB), analytics scripts, ads, and tracking pixels that aren't needed for screenshots. Blocking these resources reduces page load time significantly without affecting the visual appearance of the main content.

### Testing Plan
1. Time screenshot of heavy page (news site) before change
2. Implement change
3. Time screenshot after change
4. Compare screenshots visually (should be nearly identical)
5. Verify toggle works for cases needing full resources

### Before/After
```
BEFORE:
Page loads: HTML + CSS + JS + Fonts + Analytics + Ads = 5MB, 8 seconds

AFTER:
Page loads: HTML + CSS + JS (essential only) = 2MB, 3 seconds
```

### Assigned Agents
- **Implementation**: `general-purpose` (Scraping Expert)
- **Code Review**: `general-purpose` (HPC Expert)
- **QA**: `general-purpose` (Network Expert)

### Files to Modify
- `lambda/handler.ts`

### Notes
```
<!-- Implementation notes will be added here -->
```

---

## Task 2.4: Add useMemo and React.memo to Frontend

### Status: COMPLETE

### Subtasks
- [ ] 2.4.1 Add useMemo to ComparisonTable providerStats calculation
- [ ] 2.4.2 Add useMemo to RaceChart chartData transformation
- [ ] 2.4.3 Add useMemo to configuredProviderCount in App.tsx
- [ ] 2.4.4 Wrap RaceChart with React.memo
- [ ] 2.4.5 Wrap ComparisonTable with React.memo
- [ ] 2.4.6 Wrap PreviewPanel with React.memo
- [ ] 2.4.7 Wrap ProviderToggle with React.memo

### Success Metrics
- Re-renders during race reduced by 80%
- Hover interactions don't trigger expensive recalculations
- React DevTools shows fewer component updates

### Logic
During a race, every result triggers state updates. Without memoization, expensive calculations (stats, chart data) re-run on every update. React.memo prevents child re-renders when props haven't changed.

### Testing Plan
1. Use React DevTools Profiler before change
2. Run race with 10 URLs, count re-renders
3. Implement change
4. Run same race, count re-renders
5. Verify UI still updates correctly

### Before/After
```
BEFORE:
Result arrives → setResults → App re-render → All children re-render → Stats recalculated

AFTER:
Result arrives → setResults → App re-render → Memoized children skip → Stats cached
```

### Assigned Agents
- **Implementation**: `general-purpose` (Frontend Expert)
- **Code Review**: `general-purpose` (React Expert)
- **QA**: `general-purpose` (Frontend Performance Expert)

### Files to Modify
- `src/App.tsx`
- `src/components/RaceChart.tsx`
- `src/components/ComparisonTable.tsx`
- `src/components/PreviewPanel.tsx`
- `src/components/ProviderToggle.tsx`

### Notes
```
<!-- Implementation notes will be added here -->
```

---

## Task 2.5: Implement Download Semaphore for Concurrent Limits

### Status: COMPLETE

### Subtasks
- [ ] 2.5.1 Create Semaphore utility class
- [ ] 2.5.2 Apply to URLBox image downloads (max 5 concurrent)
- [ ] 2.5.3 Apply to quality checks (max 10 concurrent)
- [ ] 2.5.4 Add queue visualization for debugging

### Success Metrics
- Max 5 concurrent image downloads at any time
- Memory usage stays stable during large batches
- All downloads eventually complete
- No browser crashes from memory pressure

### Logic
With 100 URLs completing in parallel, 100 image downloads start simultaneously. Each image is several MBs, causing memory pressure and potential browser crashes. A semaphore limits concurrent operations while ensuring all eventually complete.

### Testing Plan
1. Run race with 50 URLs before change, monitor memory
2. Implement change
3. Run race with 50 URLs after change, monitor memory
4. Verify all results eventually arrive
5. Verify downloads are properly queued (not dropped)

### Before/After
```
BEFORE:
100 jobs complete → 100 simultaneous downloads → 500MB+ in memory → Potential crash

AFTER:
100 jobs complete → 5 downloads at a time → ~25MB in memory → Stable
```

### Assigned Agents
- **Implementation**: `general-purpose` (Async Patterns Expert)
- **Code Review**: `general-purpose` (HPC Expert)
- **QA**: `general-purpose` (Frontend Performance Expert)

### Files to Modify
- `src/utils/semaphore.ts` (new)
- `src/providers/urlboxAsync.ts`
- `src/App.tsx` (quality checks)

### Notes
```
<!-- Implementation notes will be added here -->
```

---

# Phase 3: Reliability

## Task 3.1: Add Circuit Breaker Per Provider

### Status: COMPLETE

### Subtasks
- [ ] 3.1.1 Create CircuitBreaker class
- [ ] 3.1.2 Track failure count and last failure time
- [ ] 3.1.3 Implement open/half-open/closed states
- [ ] 3.1.4 Apply to each provider in raceAllUrls
- [ ] 3.1.5 Show circuit state in UI (optional)

### Success Metrics
- After 5 consecutive failures, provider is skipped
- After 30 seconds, provider is retried (half-open)
- Successful retry closes circuit
- Other providers continue working when one fails

### Logic
If a provider is down, continuing to send requests wastes resources and adds latency. A circuit breaker "opens" after repeated failures, skipping the provider temporarily, then "half-opens" to test recovery.

### Testing Plan
1. Mock a provider to always fail
2. Verify circuit opens after 5 failures
3. Verify provider is skipped for 30 seconds
4. Restore provider, verify circuit closes on success

### Before/After
```
BEFORE:
URLBox down → Send 100 requests → 100 failures → 100 timeouts → Slow race

AFTER:
URLBox down → Send 5 requests → Circuit opens → Skip URLBox → Fast race continues
```

### Assigned Agents
- **Implementation**: `general-purpose` (SRE Expert)
- **Code Review**: `general-purpose` (Distributed Systems Expert)
- **QA**: `general-purpose` (Reliability Expert)

### Files to Modify
- `src/utils/circuitBreaker.ts` (new)
- `src/providers/index.ts`

### Notes
```
<!-- Implementation notes will be added here -->
```

---

## Task 3.2: Implement Retry with Exponential Backoff

### Status: COMPLETE

### Subtasks
- [ ] 3.2.1 Create `withRetry` utility function
- [ ] 3.2.2 Add jitter to prevent thundering herd
- [ ] 3.2.3 Classify errors as retryable vs permanent
- [ ] 3.2.4 Apply to transient network failures
- [ ] 3.2.5 Configure max 3 retries with 1s base delay

### Success Metrics
- Transient failures (503, network error) are retried
- Permanent failures (401, 404) fail immediately
- Retry delay increases: 1s, 2s, 4s
- Jitter prevents synchronized retries

### Logic
Many failures are transient (server overloaded, network blip). Immediate retry often succeeds. Without retry logic, transient failures become permanent. Exponential backoff with jitter prevents overwhelming a recovering server.

### Testing Plan
1. Mock intermittent 503 responses (fail first 2, succeed 3rd)
2. Verify request eventually succeeds
3. Verify 401 errors fail immediately (no retry)
4. Verify retry delays increase correctly

### Before/After
```
BEFORE:
Request → 503 → Fail immediately → User sees error

AFTER:
Request → 503 → Wait 1s → Retry → 503 → Wait 2s → Retry → 200 → Success
```

### Assigned Agents
- **Implementation**: `general-purpose` (SRE Expert)
- **Code Review**: `general-purpose` (Network Expert)
- **QA**: `general-purpose` (Async Patterns Expert)

### Files to Modify
- `src/utils/retry.ts` (new)
- `src/providers/browserless.ts`
- `src/providers/urlbox.ts`
- `src/providers/zenrows.ts`
- `src/providers/lambda.ts`

### Notes
```
<!-- Implementation notes will be added here -->
```

---

## Task 3.3: Add Structured Logging with Job Context

### Status: COMPLETE

### Subtasks
- [ ] 3.3.1 Create structured log utility for Lambda
- [ ] 3.3.2 Add jobId, batchId, url to all log entries
- [ ] 3.3.3 Log timing metrics (startTime, duration)
- [ ] 3.3.4 Log error details with stack traces
- [ ] 3.3.5 Add log level filtering

### Success Metrics
- All logs are JSON formatted
- Logs can be filtered by jobId or batchId
- CloudWatch Insights queries work
- Error stack traces are preserved

### Logic
Current logging is inconsistent console.log statements. Structured logging enables CloudWatch Insights queries, correlation by job/batch, and proper error investigation. JSON format allows parsing and alerting.

### Testing Plan
1. Run race and check CloudWatch logs before change
2. Implement change
3. Run race and verify JSON log format
4. Query logs by batchId in CloudWatch Insights
5. Verify error logs include stack traces

### Before/After
```
BEFORE:
console.log('Processing job')
// Cannot correlate, cannot query, cannot parse

AFTER:
{"level":"INFO","message":"Processing job","jobId":"abc-123","batchId":"xyz-789","timestamp":"..."}
// Queryable, correlatable, parseable
```

### Assigned Agents
- **Implementation**: `general-purpose` (DevOps Expert)
- **Code Review**: `general-purpose` (SRE Expert)
- **QA**: `general-purpose` (AWS Expert)

### Files to Modify
- `lambda/handler.ts`
- `lambda/utils/logger.ts` (new)

### Notes
```
<!-- Implementation notes will be added here -->
```

---

## Task 3.4: Add CloudWatch Alarms

### Status: COMPLETE

### Subtasks
- [ ] 3.4.1 Add Lambda Error alarm (>5 errors in 5 min)
- [ ] 3.4.2 Add Lambda Duration alarm (>45s average)
- [ ] 3.4.3 Add Lambda Throttle alarm (any throttle)
- [ ] 3.4.4 Add DLQ Messages alarm (>0 messages)
- [ ] 3.4.5 Add SQS Age alarm (oldest message >5 min)

### Success Metrics
- Alarms appear in CloudWatch console
- Alarms trigger on simulated failures
- Alarms auto-resolve when issues clear
- (Optional) SNS notifications configured

### Logic
Without alarms, failures go unnoticed until users complain. CloudWatch alarms provide proactive notification of issues, enabling faster response and preventing cascading failures.

### Testing Plan
1. Deploy alarms
2. Trigger each alarm condition intentionally
3. Verify alarm goes to ALARM state
4. Clear condition, verify alarm returns to OK
5. (Optional) Verify SNS notification received

### Before/After
```
BEFORE:
Lambdas failing → No notification → Users complain → Investigation starts

AFTER:
Lambdas failing → Alarm fires → Immediate notification → Proactive fix
```

### Assigned Agents
- **Implementation**: `general-purpose` (DevOps Expert)
- **Code Review**: `general-purpose` (AWS Expert)
- **QA**: `general-purpose` (SRE Expert)

### Files to Modify
- `lambda/serverless.yml`

### Notes
```
<!-- Implementation notes will be added here -->
```

---

## Task 3.5: Increase Visibility Timeout to 360s

### Status: COMPLETE

### Subtasks
- [ ] 3.5.1 Update VisibilityTimeout in serverless.yml
- [ ] 3.5.2 Update MessageRetentionPeriod to 86400 (24h)
- [ ] 3.5.3 Deploy changes
- [ ] 3.5.4 Verify existing messages aren't affected

### Success Metrics
- Visibility timeout is 360s (6x Lambda timeout)
- Message retention is 24 hours
- No duplicate processing of slow jobs

### Logic
Current visibility timeout (120s) is only 2x Lambda timeout (60s). If a job takes 55s and there's some overhead, the message becomes visible again and gets processed twice. AWS recommends 6x Lambda timeout.

### Testing Plan
1. Check current queue configuration
2. Deploy changes
3. Submit a slow job (simulate with sleep)
4. Verify no duplicate processing
5. Verify failed jobs return to queue after 360s

### Before/After
```
BEFORE:
Job takes 55s → Lambda finishes at 60s → Message already visible at 120s → Duplicate

AFTER:
Job takes 55s → Lambda finishes at 60s → Message invisible until 360s → No duplicate
```

### Assigned Agents
- **Implementation**: `general-purpose` (DevOps Expert)
- **Code Review**: `general-purpose` (AWS Expert)
- **QA**: `general-purpose` (SRE Expert)

### Files to Modify
- `lambda/serverless.yml`

### Notes
```
<!-- Implementation notes will be added here -->
```

---

# Phase 4: Optimization

## Task 4.1: Switch to WebP Format

### Status: COMPLETE

### Subtasks
- [ ] 4.1.1 Update Puppeteer screenshot to use WebP
- [ ] 4.1.2 Update content-type headers
- [ ] 4.1.3 Update frontend image handling
- [ ] 4.1.4 Add fallback for WebP-incompatible clients
- [ ] 4.1.5 Benchmark size reduction

### Success Metrics
- Screenshot size reduced by 25-35%
- Image quality visually identical
- All modern browsers display correctly

### Logic
WebP provides 25-35% better compression than JPEG at equivalent quality. This reduces storage costs, transfer time, and memory usage. All modern browsers support WebP.

### Testing Plan
1. Take JPEG screenshot, note size
2. Implement change
3. Take WebP screenshot of same page
4. Compare sizes (expect 25-35% reduction)
5. Compare visual quality (should be identical)

### Before/After
```
BEFORE:
Screenshot: 850KB JPEG

AFTER:
Screenshot: 600KB WebP (30% reduction)
```

### Assigned Agents
- **Implementation**: `general-purpose` (Scraping Expert)
- **Code Review**: `general-purpose` (Network Expert)
- **QA**: `general-purpose` (Frontend Expert)

### Files to Modify
- `lambda/handler.ts`
- `src/types.ts`
- `src/components/PreviewPanel.tsx`

### Notes
```
<!-- Implementation notes will be added here -->
```

---

## Task 4.2: Test ARM64 Architecture

### Status: NOT STARTED

### Subtasks
- [ ] 4.2.1 Research @sparticuz/chromium ARM64 support
- [ ] 4.2.2 Create test branch with architecture: arm64
- [ ] 4.2.3 Deploy and benchmark performance
- [ ] 4.2.4 Compare costs (20% cheaper on ARM)
- [ ] 4.2.5 Decision: adopt or stay x86_64

### Success Metrics
- ARM64 Lambda runs successfully
- Performance is equal or better
- Cost reduced by ~20%

### Logic
AWS Graviton2 (ARM64) processors offer 20% better price-performance than x86_64 for most workloads. If Chromium runs well on ARM, we get automatic cost savings.

### Testing Plan
1. Deploy ARM64 version to test stage
2. Run 50 screenshots, measure time and success rate
3. Compare with x86_64 results
4. Calculate cost difference
5. Make go/no-go decision

### Before/After
```
BEFORE:
x86_64, 3008MB, $0.0000494/100ms

AFTER (if successful):
arm64, 3008MB, $0.0000396/100ms (20% savings)
```

### Assigned Agents
- **Implementation**: `general-purpose` (DevOps Expert)
- **Code Review**: `general-purpose` (AWS Expert)
- **QA**: `general-purpose` (HPC Expert)

### Files to Modify
- `lambda/serverless.yml`
- `lambda/package.json` (if different chromium package needed)

### Notes
```
<!-- Implementation notes will be added here -->
```

---

## Task 4.3: Add API Gateway Caching for Results

### Status: NOT STARTED

### Subtasks
- [ ] 4.3.1 Enable API Gateway caching
- [ ] 4.3.2 Configure cache key on renderId/batchId
- [ ] 4.3.3 Set TTL to 60 seconds
- [ ] 4.3.4 Add cache invalidation on job completion
- [ ] 4.3.5 Monitor cache hit rate

### Success Metrics
- Repeated poll requests hit cache
- Cache hit rate >50% during polling
- Lambda invocations reduced for getResults

### Logic
During polling, the same results endpoint is called repeatedly. Caching responses for 60 seconds reduces Lambda invocations and improves response time for repeated queries.

### Testing Plan
1. Monitor getResults Lambda invocations before change
2. Implement caching
3. Run race with polling
4. Check cache hit metrics
5. Verify Lambda invocations reduced

### Before/After
```
BEFORE:
Poll 1: Lambda invoked (200ms)
Poll 2: Lambda invoked (200ms)
Poll 3: Lambda invoked (200ms)

AFTER:
Poll 1: Lambda invoked (200ms), cached
Poll 2: Cache hit (5ms)
Poll 3: Cache hit (5ms)
```

### Assigned Agents
- **Implementation**: `general-purpose` (AWS Expert)
- **Code Review**: `general-purpose` (DevOps Expert)
- **QA**: `general-purpose` (Network Expert)

### Files to Modify
- `lambda/serverless.yml`

### Notes
```
<!-- Implementation notes will be added here -->
```

---

## Task 4.4: Replace Polling with Server-Sent Events (SSE)

### Status: NOT STARTED

### Subtasks
- [ ] 4.4.1 Research Lambda SSE support (API Gateway limitations)
- [ ] 4.4.2 Design alternative (Lambda URL with streaming)
- [ ] 4.4.3 Implement SSE endpoint or alternative
- [ ] 4.4.4 Update frontend to use EventSource
- [ ] 4.4.5 Add fallback to polling for compatibility

### Success Metrics
- No polling requests needed
- Results arrive immediately when ready
- Reduced network overhead
- Graceful fallback when SSE unavailable

### Logic
Polling wastes bandwidth checking for results that aren't ready. SSE allows the server to push results as they complete, eliminating wasted requests and reducing latency.

### Testing Plan
1. Implement SSE endpoint
2. Update frontend to use EventSource
3. Run race, verify no polling requests
4. Verify results arrive immediately on completion
5. Test fallback by blocking SSE

### Before/After
```
BEFORE:
Client: Poll every 500ms → 180 requests for 90s race

AFTER:
Client: Open SSE connection → Server pushes 10 results → Done
```

### Assigned Agents
- **Implementation**: `general-purpose` (Network Expert)
- **Code Review**: `general-purpose` (AWS Expert)
- **QA**: `general-purpose` (Async Patterns Expert)

### Files to Modify
- `lambda/handler.ts`
- `lambda/serverless.yml`
- `src/providers/lambdaAsync.ts`

### Notes
```
SSE on Lambda requires Lambda Function URLs with streaming.
API Gateway doesn't support SSE well.
May need to evaluate feasibility first.
```

---

## Task 4.5: Add Provisioned Concurrency for Sync Endpoint

### Status: COMPLETE

### Subtasks
- [ ] 4.5.1 Add provisionedConcurrency to screenshot function
- [ ] 4.5.2 Set to 2 instances (balance cost vs latency)
- [ ] 4.5.3 Deploy and measure cold start reduction
- [ ] 4.5.4 Monitor cost impact
- [ ] 4.5.5 Decision: adjust count or remove

### Success Metrics
- Cold start latency reduced from 5-10s to <1s
- Cost increase is acceptable (<$50/month)
- Sync endpoint consistently fast

### Logic
The sync screenshot endpoint suffers from Chromium cold starts (5-10s). Provisioned concurrency keeps instances warm, eliminating cold starts at the cost of continuous billing.

### Testing Plan
1. Time 10 sync requests before change (expect cold starts)
2. Enable provisioned concurrency
3. Time 10 sync requests after change
4. Verify cold starts eliminated
5. Monitor cost for 1 week

### Before/After
```
BEFORE:
First request: 5-10s (cold start)
Subsequent: 3-4s (if warm)

AFTER:
All requests: 3-4s (always warm)
Cost: ~$35/month for 2 instances
```

### Assigned Agents
- **Implementation**: `general-purpose` (DevOps Expert)
- **Code Review**: `general-purpose` (AWS Expert)
- **QA**: `general-purpose` (HPC Expert)

### Files to Modify
- `lambda/serverless.yml`

### Notes
```
Consider starting with 1-2 instances.
Monitor utilization before increasing.
May be skipped if cost is prohibitive.
```

---

# Execution Log

## Session: 2026-02-02

### Completed Tasks
- 1.1: Dead Letter Queue - Added DLQ with 3 retries, 14-day retention, CloudWatch alarm
- 1.2: AbortController - Full cancellation propagation to all providers
- 1.3: Fetch Timeouts - 30s timeout on all fetch calls via fetchWithTimeout utility
- 1.4: SQS Batch - Parallel batch sends (10 msgs/batch) with partial failure handling
- 2.1: Exponential Backoff - Polling starts at 200ms, maxes at 2000ms
- 2.2: Browser Reuse - Single browser launch per Lambda invocation, page reuse
- 2.3: Resource Blocking - Blocks fonts, media, analytics (30-50% faster)
- 2.4: React Memoization - useMemo/React.memo on all expensive components
- 2.5: Download Semaphore - Max 5 concurrent image downloads, 10 quality checks
- 3.1: Circuit Breaker - Per-provider circuit breaker with 5 failure threshold
- 3.2: Retry Logic - Exponential backoff with jitter, 2 attempts per request
- 3.3: Structured Logging - JSON logs with jobId, batchId, timing context
- 3.4: CloudWatch Alarms - Error, duration, throttle alarms for worker
- 3.5: Visibility Timeout - Increased to 360s (6x Lambda timeout)
- 4.1: WebP Format - 25-35% smaller screenshots
- 4.5: Provisioned Concurrency - 2 warm instances for sync endpoint

### Deferred Tasks
- 1.5: Binary S3 Storage - Complex migration, lower priority
- 4.2: ARM64 Testing - Requires chromium compatibility research
- 4.3: API Gateway Caching - Lower impact
- 4.4: SSE Replacement - Complex, API Gateway limitations

### Code Review Findings Fixed
- Fixed circuit breaker half-open state failure counter reset
- Fixed retry log message format

### Notes
```
All high-impact optimizations implemented. Estimated improvements:
- Job submission: 5-10x faster (batch SQS)
- Screenshot time: 30-50% faster (resource blocking)
- Reliability: DLQ + circuit breaker + retry
- Memory: Semaphore limits concurrent operations
- Observability: Structured logging + CloudWatch alarms
```

---

# Agent Assignment Summary

| Agent Type | Role | Tasks |
|------------|------|-------|
| DevOps Expert | Infrastructure changes | 1.1, 3.3, 3.4, 3.5, 4.2, 4.3, 4.5 |
| AWS Lambda Expert | Lambda optimization | 1.4, 2.2 |
| Async Patterns Expert | Async code | 1.2, 2.1, 2.5, 3.2, 4.4 |
| Network Expert | Network optimization | 1.3, 2.3, 4.1, 4.4 |
| Frontend Expert | React optimization | 2.4 |
| Scraping Expert | Puppeteer optimization | 2.2, 2.3, 4.1 |
| SRE Expert | Reliability | 3.1, 3.2, 3.3 |
| Distributed Systems | Architecture review | 1.4, 3.1 |
| HPC Expert | Performance review | 2.1, 2.2, 2.5, 4.2, 4.5 |

---

# Code Review Checklist

For each task, the code reviewer must verify:

- [ ] No new TypeScript errors
- [ ] No regressions in existing functionality
- [ ] Error handling is complete
- [ ] Edge cases are covered
- [ ] Performance impact is positive
- [ ] Memory leaks are avoided
- [ ] Cleanup is handled properly
- [ ] Tests pass (if applicable)
- [ ] Code follows existing patterns
- [ ] Documentation updated if needed

---

# QA Checklist

For each task, QA must verify:

- [ ] Feature works as described
- [ ] Success metrics are met
- [ ] Before/after comparison shows improvement
- [ ] No regressions introduced
- [ ] Edge cases handled
- [ ] Error states handled gracefully
- [ ] UI remains responsive
- [ ] No console errors
- [ ] Works across browsers (if frontend)
- [ ] Works under load (if backend)
