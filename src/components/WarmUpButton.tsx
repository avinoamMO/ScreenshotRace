import { useState } from 'react';
import type { ApiKeys, ProviderName } from '../types';
import { PROVIDERS, isProviderConfigured } from '../types';
import { takeScreenshot } from '../providers';

interface WarmUpButtonProps {
  apiKeys: ApiKeys;
  enabledProviders: ProviderName[];
}

interface WarmUpStatus {
  provider: ProviderName;
  status: 'pending' | 'testing' | 'success' | 'error';
  timeMs?: number;
  error?: string;
}

export function WarmUpButton({ apiKeys, enabledProviders }: WarmUpButtonProps) {
  const [isWarming, setIsWarming] = useState(false);
  const [statuses, setStatuses] = useState<WarmUpStatus[]>([]);
  const [showResults, setShowResults] = useState(false);

  const configuredProviders = enabledProviders.filter((p) =>
    isProviderConfigured(p, apiKeys)
  );

  const handleWarmUp = async () => {
    if (configuredProviders.length === 0) return;

    setIsWarming(true);
    setShowResults(true);

    // Initialize all as pending
    const initialStatuses: WarmUpStatus[] = configuredProviders.map((p) => ({
      provider: p,
      status: 'pending',
    }));
    setStatuses(initialStatuses);

    // Test each provider in parallel
    const testUrl = 'https://example.com';

    await Promise.all(
      configuredProviders.map(async (provider) => {
        // Mark as testing
        setStatuses((prev) =>
          prev.map((s) =>
            s.provider === provider ? { ...s, status: 'testing' } : s
          )
        );

        try {
          const result = await takeScreenshot(provider, testUrl, apiKeys);

          setStatuses((prev) =>
            prev.map((s) =>
              s.provider === provider
                ? {
                    ...s,
                    status: result.success ? 'success' : 'error',
                    timeMs: result.timeMs,
                    error: result.error,
                  }
                : s
            )
          );
        } catch (error) {
          setStatuses((prev) =>
            prev.map((s) =>
              s.provider === provider
                ? {
                    ...s,
                    status: 'error',
                    error: error instanceof Error ? error.message : 'Unknown error',
                  }
                : s
            )
          );
        }
      })
    );

    setIsWarming(false);
  };

  const getProviderColor = (name: ProviderName) => {
    return PROVIDERS.find((p) => p.name === name)?.color || '#888';
  };

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <div className="relative">
      <button
        onClick={handleWarmUp}
        disabled={isWarming || configuredProviders.length === 0}
        className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium rounded-lg transition-colors"
      >
        {isWarming ? (
          <>
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Warming Up...
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z"
              />
            </svg>
            Warm Up
          </>
        )}
      </button>

      {/* Results dropdown */}
      {showResults && statuses.length > 0 && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50">
          <div className="p-3 border-b border-gray-700 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-300">Warm Up Results</span>
            <button
              onClick={() => setShowResults(false)}
              className="text-gray-500 hover:text-gray-300"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-2 space-y-1">
            {statuses.map((status) => (
              <div
                key={status.provider}
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-900/50"
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: getProviderColor(status.provider) }}
                  />
                  <span className="text-sm text-gray-300 capitalize">{status.provider}</span>
                </div>
                <div className="flex items-center gap-2">
                  {status.status === 'pending' && (
                    <span className="text-xs text-gray-500">Waiting...</span>
                  )}
                  {status.status === 'testing' && (
                    <svg className="animate-spin h-4 w-4 text-amber-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {status.status === 'success' && (
                    <>
                      <span className="text-xs text-gray-400 font-mono">
                        {status.timeMs ? formatTime(status.timeMs) : ''}
                      </span>
                      <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </>
                  )}
                  {status.status === 'error' && (
                    <div className="flex items-center gap-1" title={status.error}>
                      <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {!isWarming && (
            <div className="p-2 border-t border-gray-700">
              <div className="text-xs text-gray-500 text-center">
                {statuses.filter((s) => s.status === 'success').length}/{statuses.length} providers ready
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
