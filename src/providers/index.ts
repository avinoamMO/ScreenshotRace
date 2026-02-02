import type { ApiKeys, ProviderName, ScreenshotResult } from '../types';
import { takeScreenshot as browserlessScreenshot } from './browserless';
import { takeScreenshot as urlboxScreenshot } from './urlbox';
import { takeScreenshotBatch as urlboxAsyncBatch } from './urlboxAsync';
import { takeScreenshot as zenrowsScreenshot } from './zenrows';
import { takeScreenshot as lambdaScreenshot } from './lambda';
import { takeScreenshotBatch as lambdaAsyncBatch } from './lambdaAsync';

// Async providers that support batch processing
const ASYNC_PROVIDERS: ProviderName[] = ['urlboxAsync', 'lambdaAsync'];

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

// For single URL racing (used by warmup)
export async function raceProviders(
  url: string,
  enabledProviders: ProviderName[],
  apiKeys: ApiKeys,
  onProgress?: (result: ScreenshotResult) => void
): Promise<ScreenshotResult[]> {
  const promises = enabledProviders.map(async (providerName) => {
    let result: ScreenshotResult;

    // For async providers, use batch function with single URL
    if (providerName === 'urlboxAsync') {
      const results = await urlboxAsyncBatch([url], apiKeys.urlboxKey || '', apiKeys.urlboxSecret || '');
      result = results[0];
    } else if (providerName === 'lambdaAsync') {
      const results = await lambdaAsyncBatch([url], apiKeys.lambdaUrl || '');
      result = results[0];
    } else {
      result = await takeScreenshot(providerName, url, apiKeys);
    }

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

// Race all URLs across all providers with true async parallelism
export async function raceAllUrls(
  urls: string[],
  enabledProviders: ProviderName[],
  apiKeys: ApiKeys,
  onProgress?: (result: ScreenshotResult) => void
): Promise<Map<string, ScreenshotResult[]>> {
  const resultsMap = new Map<string, ScreenshotResult[]>();

  // Initialize results map
  for (const url of urls) {
    resultsMap.set(url, []);
  }

  // Separate async and sync providers
  const asyncProviders = enabledProviders.filter(p => ASYNC_PROVIDERS.includes(p));
  const syncProviders = enabledProviders.filter(p => !ASYNC_PROVIDERS.includes(p));

  // Start async providers with ALL URLs at once (true parallelism)
  const asyncPromises: Promise<void>[] = [];

  if (asyncProviders.includes('urlboxAsync')) {
    asyncPromises.push(
      urlboxAsyncBatch(urls, apiKeys.urlboxKey || '', apiKeys.urlboxSecret || '')
        .then(results => {
          for (const result of results) {
            const urlResults = resultsMap.get(result.url) || [];
            urlResults.push(result);
            resultsMap.set(result.url, urlResults);
            onProgress?.(result);
          }
        })
        .catch(error => {
          console.error('URLBox Async batch failed:', error);
          // Add error results for all URLs
          for (const url of urls) {
            const result: ScreenshotResult = {
              provider: 'urlboxAsync',
              url,
              success: false,
              timeMs: 0,
              error: error instanceof Error ? error.message : 'Batch failed',
            };
            const urlResults = resultsMap.get(url) || [];
            urlResults.push(result);
            resultsMap.set(url, urlResults);
            onProgress?.(result);
          }
        })
    );
  }

  if (asyncProviders.includes('lambdaAsync')) {
    asyncPromises.push(
      lambdaAsyncBatch(urls, apiKeys.lambdaUrl || '')
        .then(results => {
          for (const result of results) {
            const urlResults = resultsMap.get(result.url) || [];
            urlResults.push(result);
            resultsMap.set(result.url, urlResults);
            onProgress?.(result);
          }
        })
        .catch(error => {
          console.error('Lambda Async batch failed:', error);
          for (const url of urls) {
            const result: ScreenshotResult = {
              provider: 'lambdaAsync',
              url,
              success: false,
              timeMs: 0,
              error: error instanceof Error ? error.message : 'Batch failed',
            };
            const urlResults = resultsMap.get(url) || [];
            urlResults.push(result);
            resultsMap.set(url, urlResults);
            onProgress?.(result);
          }
        })
    );
  }

  // Process sync providers URL by URL (but all sync providers in parallel per URL)
  const syncPromises: Promise<void>[] = [];

  for (const url of urls) {
    for (const provider of syncProviders) {
      syncPromises.push(
        takeScreenshot(provider, url, apiKeys)
          .then(result => {
            const urlResults = resultsMap.get(url) || [];
            urlResults.push(result);
            resultsMap.set(url, urlResults);
            onProgress?.(result);
          })
          .catch(error => {
            const result: ScreenshotResult = {
              provider,
              url,
              success: false,
              timeMs: 0,
              error: error instanceof Error ? error.message : 'Unknown error',
            };
            const urlResults = resultsMap.get(url) || [];
            urlResults.push(result);
            resultsMap.set(url, urlResults);
            onProgress?.(result);
          })
      );
    }
  }

  // Wait for all to complete
  await Promise.all([...asyncPromises, ...syncPromises]);

  return resultsMap;
}
