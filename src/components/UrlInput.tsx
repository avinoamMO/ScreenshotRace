import { useState } from 'react';
import type { ApiKeys, ProviderName } from '../types';
import { isProviderConfigured } from '../types';
import { takeScreenshot } from '../providers';

interface UrlInputProps {
  onRace: (urls: string[]) => void;
  isRacing: boolean;
  apiKeys: ApiKeys;
  enabledProviders: ProviderName[];
}

const DEFAULT_URLS = [
  'https://example.com',
  'https://news.ycombinator.com',
  'https://github.com',
];

const NEWS_URLS = [
  'https://www.nytimes.com',
  'https://www.bbc.com/news',
  'https://www.cnn.com',
  'https://www.theguardian.com',
  'https://www.washingtonpost.com',
  'https://www.reuters.com',
  'https://www.bloomberg.com',
  'https://www.wsj.com',
  'https://www.npr.org',
  'https://www.apnews.com',
  'https://www.usatoday.com',
  'https://www.nbcnews.com',
  'https://www.cbsnews.com',
  'https://www.abcnews.go.com',
  'https://www.foxnews.com',
  'https://www.politico.com',
  'https://www.theatlantic.com',
  'https://www.economist.com',
  'https://www.forbes.com',
  'https://www.wired.com',
  'https://techcrunch.com',
  'https://www.theverge.com',
  'https://arstechnica.com',
  'https://www.engadget.com',
];

function getRandomUrls(count: number): string[] {
  const shuffled = [...NEWS_URLS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export function UrlInput({ onRace, isRacing, apiKeys, enabledProviders }: UrlInputProps) {
  const [urlText, setUrlText] = useState(DEFAULT_URLS.join('\n'));
  const [isWarming, setIsWarming] = useState(false);
  const [warmUpComplete, setWarmUpComplete] = useState(false);
  const [populateCount, setPopulateCount] = useState(5);

  const configuredProviders = enabledProviders.filter((p) =>
    isProviderConfigured(p, apiKeys)
  );

  const handleWarmUp = async () => {
    if (configuredProviders.length === 0) return;

    setIsWarming(true);
    setWarmUpComplete(false);

    const testUrl = 'https://example.com';

    // Warm up all providers in parallel
    await Promise.all(
      configuredProviders.map(async (provider) => {
        try {
          await takeScreenshot(provider, testUrl, apiKeys);
        } catch {
          // Ignore errors during warmup
        }
      })
    );

    setIsWarming(false);
    setWarmUpComplete(true);

    // Hide arrow after 5 seconds
    setTimeout(() => setWarmUpComplete(false), 5000);
  };

  const handleRace = () => {
    setWarmUpComplete(false);
    const urls = urlText
      .split('\n')
      .map((url) => url.trim())
      .filter((url) => url.length > 0)
      .filter((url) => {
        try {
          new URL(url);
          return true;
        } catch {
          return false;
        }
      });

    if (urls.length > 0) {
      onRace(urls);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <label className="block text-sm font-medium text-gray-300 mb-2">
        Enter URLs to race (one per line)
      </label>
      <textarea
        value={urlText}
        onChange={(e) => setUrlText(e.target.value)}
        placeholder="https://example.com"
        className="w-full h-32 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm resize-none"
        disabled={isRacing}
      />
      <div className="mt-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          {/* - Button */}
          <button
            onClick={() => setPopulateCount((c) => Math.max(1, c - 1))}
            disabled={isRacing || populateCount <= 1}
            className="w-8 h-8 flex items-center justify-center bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-gray-300 rounded-lg transition-colors text-lg font-bold"
          >
            -
          </button>

          {/* Populate URLs Button with count */}
          <button
            onClick={() => setUrlText(getRandomUrls(populateCount).join('\n'))}
            disabled={isRacing}
            className="text-sm px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-gray-300 rounded-lg transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Populate {populateCount} URLs
          </button>

          {/* + Button */}
          <button
            onClick={() => setPopulateCount((c) => Math.min(NEWS_URLS.length, c + 1))}
            disabled={isRacing || populateCount >= NEWS_URLS.length}
            className="w-8 h-8 flex items-center justify-center bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-gray-300 rounded-lg transition-colors text-lg font-bold"
          >
            +
          </button>
        </div>
        <div className="flex items-center gap-3">
          {/* Warm Up Button */}
          <button
            onClick={handleWarmUp}
            disabled={isWarming || isRacing || configuredProviders.length === 0}
            className="px-4 py-3 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold rounded-lg transition-all duration-200 flex items-center gap-2"
            title="Wake up Lambda and verify all providers"
          >
            {isWarming ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Warming...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
                </svg>
                Warm Up
              </>
            )}
          </button>

          {/* Arrow pointing to Race */}
          {warmUpComplete && (
            <div className="flex items-center gap-1 text-green-400 animate-pulse">
              <span className="text-sm font-medium">Ready!</span>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </div>
          )}

          {/* Race Button */}
          <button
            onClick={handleRace}
            disabled={isRacing}
            className={`px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:from-gray-600 disabled:to-gray-700 text-white font-semibold rounded-lg transition-all duration-200 flex items-center gap-2 ${warmUpComplete ? 'ring-2 ring-green-400 ring-offset-2 ring-offset-gray-900' : ''}`}
          >
            {isRacing ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Racing...
              </>
            ) : (
              <>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Race!
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
