import type { ApiKeys, ProviderName, ScreenshotResult } from '../types';
import { takeScreenshot as browserlessScreenshot } from './browserless';
import { takeScreenshot as urlboxScreenshot } from './urlbox';
import { takeScreenshot as zenrowsScreenshot } from './zenrows';
import { takeScreenshot as lambdaScreenshot } from './lambda';

export async function takeScreenshot(
  provider: ProviderName,
  url: string,
  apiKeys: ApiKeys
): Promise<ScreenshotResult> {
  switch (provider) {
    case 'browserless':
      return browserlessScreenshot(url, apiKeys.browserless || '');
    case 'urlbox':
      return urlboxScreenshot(url, apiKeys.urlboxKey || '', apiKeys.urlboxSecret || '');
    case 'zenrows':
      return zenrowsScreenshot(url, apiKeys.zenrows || '');
    case 'lambda':
      return lambdaScreenshot(url, apiKeys.lambdaUrl || '');
    default:
      return {
        provider,
        url,
        success: false,
        timeMs: 0,
        error: 'Unknown provider',
      };
  }
}

export async function raceProviders(
  url: string,
  enabledProviders: ProviderName[],
  apiKeys: ApiKeys,
  onProgress?: (result: ScreenshotResult) => void
): Promise<ScreenshotResult[]> {
  const promises = enabledProviders.map(async (providerName) => {
    const result = await takeScreenshot(providerName, url, apiKeys);
    onProgress?.(result);
    return result;
  });

  const results = await Promise.allSettled(promises);

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      provider: enabledProviders[index],
      url,
      success: false,
      timeMs: 0,
      error: result.reason?.message || 'Unknown error',
    };
  });
}
