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

export type ProviderName = 'browserless' | 'urlbox' | 'zenrows' | 'lambda';

export interface ProviderConfig {
  name: ProviderName;
  color: string;
  enabled: boolean;
}

export const PROVIDERS: ProviderConfig[] = [
  { name: 'browserless', color: '#8b5cf6', enabled: true }, // purple
  { name: 'urlbox', color: '#3b82f6', enabled: true },      // blue
  { name: 'zenrows', color: '#22c55e', enabled: true },     // green
  { name: 'lambda', color: '#f97316', enabled: true },      // orange
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
      return !!apiKeys.urlboxKey && !!apiKeys.urlboxSecret;
    case 'zenrows':
      return !!apiKeys.zenrows;
    case 'lambda':
      return !!apiKeys.lambdaUrl;
    default:
      return false;
  }
}
