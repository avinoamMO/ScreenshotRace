export interface ScreenshotResult {
  provider: string;
  url: string;
  success: boolean;
  timeMs: number;
  imageData?: string; // base64 data URL
  imageSize?: number; // bytes
  error?: string;
  quality?: QualityResult;
}

export interface QualityResult {
  passed: boolean;
  sizeOk: boolean;
  noErrorText: boolean;
  noPaywall: boolean;
  details: string[];
}

export interface RaceResult {
  url: string;
  results: ScreenshotResult[];
}

export type ProviderName =
  | 'browserless'
  | 'urlbox'
  | 'urlboxAsync'
  | 'zenrows'
  | 'lambda'
  | 'lambdaAsync';

export interface ProviderConfig {
  name: ProviderName;
  label: string;
  color: string;
  enabled: boolean;
  isAsync?: boolean;
}

export const PROVIDERS: ProviderConfig[] = [
  { name: 'browserless', label: 'Browserless', color: '#8b5cf6', enabled: true },
  { name: 'urlbox', label: 'URLBox', color: '#3b82f6', enabled: true },
  { name: 'urlboxAsync', label: 'URLBox Async', color: '#06b6d4', enabled: true, isAsync: true },
  { name: 'zenrows', label: 'ZenRows', color: '#22c55e', enabled: true },
  { name: 'lambda', label: 'Lambda', color: '#f97316', enabled: true },
  { name: 'lambdaAsync', label: 'Lambda Async', color: '#ec4899', enabled: true, isAsync: true },
];

export interface ApiKeys {
  browserless?: string;
  urlboxKey?: string;
  urlboxSecret?: string;
  zenrows?: string;
  lambdaUrl?: string;
  anthropic?: string;
}

export function isProviderConfigured(
  provider: ProviderName,
  apiKeys: ApiKeys | undefined
): boolean {
  if (!apiKeys) return false;
  switch (provider) {
    case 'browserless':
      return !!apiKeys.browserless;
    case 'urlbox':
    case 'urlboxAsync':
      return !!apiKeys.urlboxKey && !!apiKeys.urlboxSecret;
    case 'zenrows':
      return !!apiKeys.zenrows;
    case 'lambda':
      return !!apiKeys.lambdaUrl;
    case 'lambdaAsync':
      // Lambda Async only needs Lambda URL (uses its own Puppeteer via SQS)
      return !!apiKeys.lambdaUrl;
    default:
      return false;
  }
}
