# Contributing to ScreenshotRace

Thanks for your interest in contributing. This guide covers how to set up the project, write code, run tests, and submit changes.

## Development Setup

### Prerequisites

- Node.js 20+
- npm
- AWS CLI (configured credentials for deployment testing)
- Serverless Framework v3 (for local invocation)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/avinoamMO/ScreenshotRace.git
cd ScreenshotRace

# Install dependencies
npm install

# Run tests
npm test

# Run linting
npm run lint

# Check types
npm run typecheck

# Check formatting
npm run format:check
```

### Running Locally

You can invoke the Lambda handler locally with Serverless:

```bash
npm run invoke
```

This requires a `serverless.yml`-compatible environment and AWS credentials.

## Project Structure

```
ScreenshotRace/
  handler.ts          # Lambda entry point (API Gateway handlers)
  orchestrator.ts     # Multi-provider race logic
  providers.ts        # Screenshot provider implementations
  scoring.ts          # Composite scoring algorithm
  aiQuality.ts        # Claude-based AI quality evaluation
  serverless.yml      # AWS infrastructure definition
  sdk/                # TypeScript SDK for API consumers
  tests/
    handler.test.ts   # API handler tests
    providers.test.ts # Provider unit tests
    scoring.test.ts   # Scoring algorithm tests
    aiQuality.test.ts # AI quality evaluation tests
  docs/               # Documentation site
```

## Code Style

- **TypeScript strict mode** -- all code must pass `npm run typecheck`
- **ESLint + Prettier** -- run `npm run lint:fix` and `npm run format` before committing
- **JSDoc comments** on all exported functions
- Use `const` by default; `let` only when reassignment is needed
- Avoid `any` types; use proper generics or explicit types

## Testing

All changes must include tests. The project uses Vitest.

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run a specific test file
npx vitest run tests/scoring.test.ts
```

### What to Test

- **New providers**: Mock the external API; test success, failure, and timeout paths
- **Scoring changes**: Test edge cases (zero-size images, missing AI verdicts, tied scores)
- **AI quality**: Mock Claude API responses; test all verdict types (OK, paywall, error, invalid)
- **Handler changes**: Test request validation, error responses, and happy paths

## Making Changes

### Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run the full verification suite:
   ```bash
   npm test && npm run lint && npm run typecheck
   ```
5. Commit with a clear message: `git commit -m "feat: add new provider"`
6. Push and open a pull request

### Commit Messages

Use conventional commit format:

- `feat: add ZenRows retry logic`
- `fix: handle empty screenshot from URLBox`
- `docs: update scoring algorithm table`
- `test: add edge case for zero-size images`
- `chore: update vitest to v4`

### Adding a New Screenshot Provider

1. Add the provider function in `providers.ts` following the existing pattern
2. Add it to the race array in `orchestrator.ts`
3. Add the API key to the environment variables table in `README.md`
4. Write tests covering success, failure, and timeout
5. Update `serverless.yml` if the provider needs new IAM permissions

## Areas Where Help Is Welcome

### High Priority
- **New providers** -- Playwright, ScreenshotOne, or other screenshot APIs
- **Paywall bypass strategies** -- Additional remediation approaches
- **Performance** -- Reduce cold start time, optimize image processing

### Medium Priority
- **SDK improvements** -- Better TypeScript types, retry logic, streaming support
- **Monitoring** -- CloudWatch dashboard templates, alerting recipes
- **Documentation** -- Architecture diagrams, deployment guides

### Nice to Have
- **Output formats** -- Support PNG, JPEG alongside WebP
- **Viewport options** -- Mobile, tablet, custom dimensions
- **Webhook callbacks** -- Notify when batch completes instead of polling

## Reporting Bugs

Open an issue with:

1. The URL you tried to screenshot (if not sensitive)
2. The API response you received
3. Expected vs. actual behavior
4. Which providers were involved (if known from the `attempts` array)
5. Your deployment stage (dev/prod) and region

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
