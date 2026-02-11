---
name: Bug Report
about: Report a bug with screenshot quality, provider failures, or API behavior
title: "[Bug] "
labels: bug
assignees: ''
---

## Description

A clear description of what the bug is.

## Steps to Reproduce

1. Send a request to the API:
   ```bash
   curl -X POST "$BASE_URL/screenshot-optimized" \
     -H "Content-Type: application/json" \
     -H "x-api-key: $API_KEY" \
     -d '{"urls": "https://example.com"}'
   ```
2. Poll for results
3. Observe the issue

## Expected Behavior

What should happen (e.g., high-quality screenshot returned, correct provider selected).

## Actual Behavior

What actually happens (e.g., blank image, wrong provider wins, timeout).

## API Response

```json
Paste the full JSON response from /results here, including the attempts array.
```

## Environment

- **Stage**: dev / prod
- **AWS Region**: us-east-1 / other
- **Node.js version**: (`node --version`)
- **Serverless Framework version**: (`npx serverless --version`)
- **Providers configured**: Puppeteer / Browserless / URLBox / ZenRows

## Target URL

The URL you were trying to screenshot (if not sensitive):

```
https://example.com
```

## Additional Context

- Is this a paywall/login-wall issue?
- Does the URL work in a regular browser?
- Is this reproducible or intermittent?
