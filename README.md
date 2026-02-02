# ScreenshotRace

A benchmarking tool to compare screenshot API providers side-by-side. Race multiple providers against each other to find the fastest and most reliable option for your needs.

![React](https://img.shields.io/badge/React-18-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Vite](https://img.shields.io/badge/Vite-5-purple)

## Features

- **Multi-Provider Racing** - Compare Browserless, URLBox, ZenRows, and your own AWS Lambda simultaneously
- **Real-time Stopwatch** - Track total race time with millisecond precision
- **Visual Chart** - Grouped bar chart showing response times per URL per provider
- **Comparison Table** - Detailed stats including success rate, avg/min/max times, and file sizes
- **Warm Up** - Pre-warm Lambda and verify all provider connections before racing
- **Screenshot Preview** - Hover over results to preview the captured screenshots
- **Populate URLs** - One-click to fill with random real news website URLs

## Supported Providers

| Provider | Type | Notes |
|----------|------|-------|
| [Browserless](https://browserless.io) | Cloud API | Fast, reliable headless Chrome |
| [URLBox](https://urlbox.io) | Cloud API | Requires API key + secret for HMAC signing |
| [ZenRows](https://zenrows.com) | Cloud API | Web scraping API with screenshot support |
| AWS Lambda | Self-hosted | Your own serverless screenshot function |

## Installation

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/AviNoah/ScreenshotRace.git
   cd ScreenshotRace
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```

4. **Open in browser**
   ```
   http://localhost:5173
   ```

## Configuration

Click the **Settings** button in the top-right to configure your API keys:

### Browserless
- Sign up at [browserless.io](https://browserless.io)
- Copy your API key from the dashboard

### URLBox
- Sign up at [urlbox.io](https://urlbox.io)
- You need both the **API Key** and **Secret** for HMAC signing

### ZenRows
- Sign up at [zenrows.com](https://zenrows.com)
- Copy your API key from the dashboard

### AWS Lambda (Optional)

Deploy your own screenshot Lambda for comparison:

1. **Navigate to the lambda folder**
   ```bash
   cd lambda
   npm install
   ```

2. **Configure AWS credentials**
   ```bash
   export AWS_ACCESS_KEY_ID=your_key
   export AWS_SECRET_ACCESS_KEY=your_secret
   ```

3. **Deploy**
   ```bash
   npm run deploy
   ```

4. **Copy the endpoint URL** (e.g., `https://xxx.execute-api.us-east-1.amazonaws.com/dev`)

5. **Paste in Settings** (without `/screenshot` - the app adds it automatically)

#### Lambda Cold Start Optimization

The Lambda is configured with 3008 MB memory for faster cold starts. First request after ~15 min idle will be slower. Use the **Warm Up** button before racing to pre-warm the Lambda.

## Usage

1. **Configure API Keys** - Click Settings and enter your provider credentials
2. **Select Providers** - Toggle which providers to include in the race
3. **Enter URLs** - Add URLs to test (one per line) or click "Populate URLs" for random news sites
4. **Warm Up (Optional)** - Click to pre-warm Lambda and verify all connections
5. **Race!** - Click to start the benchmark
6. **Analyze Results** - View the chart, table, and hover for screenshot previews

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Lambda**: Node.js 20, Puppeteer, @sparticuz/chromium
- **Deployment**: Serverless Framework

## Project Structure

```
screenshot-race/
├── src/
│   ├── components/       # React components
│   │   ├── RaceChart.tsx
│   │   ├── ComparisonTable.tsx
│   │   ├── Stopwatch.tsx
│   │   ├── UrlInput.tsx
│   │   └── ...
│   ├── providers/        # API provider implementations
│   │   ├── browserless.ts
│   │   ├── urlbox.ts
│   │   ├── zenrows.ts
│   │   └── lambda.ts
│   ├── App.tsx
│   └── types.ts
├── lambda/               # AWS Lambda function
│   ├── handler.ts
│   ├── serverless.yml
│   └── package.json
└── package.json
```

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
