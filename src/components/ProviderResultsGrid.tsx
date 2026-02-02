import { memo, useMemo } from 'react';
import type { RaceResult, ScreenshotResult } from '../types';
import { PROVIDERS } from '../types';

interface ProviderResultsGridProps {
  results: RaceResult[];
}

export const ProviderResultsGrid = memo(function ProviderResultsGrid({
  results,
}: ProviderResultsGridProps) {
  // Organize results by provider
  const resultsByProvider = useMemo(() => {
    const byProvider = new Map<string, ScreenshotResult[]>();

    // Initialize all providers
    PROVIDERS.forEach(p => byProvider.set(p.name, []));

    // Collect results by provider
    for (const raceResult of results) {
      for (const result of raceResult.results) {
        const providerResults = byProvider.get(result.provider) || [];
        providerResults.push(result);
        byProvider.set(result.provider, providerResults);
      }
    }

    return byProvider;
  }, [results]);

  // Get providers that have results
  const activeProviders = PROVIDERS.filter(
    p => (resultsByProvider.get(p.name)?.length || 0) > 0
  );

  if (activeProviders.length === 0) {
    return null;
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <h2 className="text-lg font-medium text-gray-300 mb-4">
        Results by Provider
      </h2>

      <div className="grid gap-4" style={{
        gridTemplateColumns: `repeat(${activeProviders.length}, minmax(200px, 1fr))`
      }}>
        {activeProviders.map(provider => {
          const providerResults = resultsByProvider.get(provider.name) || [];

          return (
            <div key={provider.name} className="flex flex-col">
              {/* Provider Header */}
              <div
                className="text-center py-2 px-3 rounded-t-lg font-medium text-white mb-2"
                style={{ backgroundColor: provider.color }}
              >
                {provider.label}
                <span className="ml-2 text-xs opacity-75">
                  ({providerResults.length} results)
                </span>
              </div>

              {/* Results Column */}
              <div className="flex flex-col gap-3 max-h-[600px] overflow-y-auto pr-1">
                {providerResults.map((result, index) => (
                  <ProviderResultCard
                    key={`${result.url}-${index}`}
                    result={result}
                    providerColor={provider.color}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

interface ProviderResultCardProps {
  result: ScreenshotResult;
  providerColor: string;
}

function ProviderResultCard({ result, providerColor }: ProviderResultCardProps) {
  // Extract domain from URL for display
  const domain = useMemo(() => {
    try {
      return new URL(result.url).hostname.replace('www.', '');
    } catch {
      return result.url;
    }
  }, [result.url]);

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
      {/* Image */}
      {result.success && result.imageData ? (
        <div className="relative">
          <img
            src={result.imageData}
            alt={`Screenshot of ${domain}`}
            className="w-full h-auto"
            loading="lazy"
          />
          {/* Success overlay */}
          <div className="absolute top-1 right-1 bg-green-500 text-white text-xs px-1.5 py-0.5 rounded">
            ✓
          </div>
        </div>
      ) : (
        <div className="h-32 bg-gray-800 flex items-center justify-center">
          <span className="text-red-400 text-sm px-2 text-center">
            {result.error || 'Failed'}
          </span>
        </div>
      )}

      {/* Data */}
      <div className="p-2 text-xs space-y-1">
        <div className="text-gray-400 truncate" title={result.url}>
          {domain}
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Time:</span>
          <span
            className="font-mono"
            style={{ color: providerColor }}
          >
            {(result.timeMs / 1000).toFixed(2)}s
          </span>
        </div>
        {result.imageSize && (
          <div className="flex justify-between">
            <span className="text-gray-500">Size:</span>
            <span className="text-gray-300 font-mono">
              {(result.imageSize / 1024).toFixed(0)}KB
            </span>
          </div>
        )}
        {result.quality && (
          <div className="flex justify-between">
            <span className="text-gray-500">Quality:</span>
            <span className={result.quality.passed ? 'text-green-400' : 'text-yellow-400'}>
              {result.quality.passed ? 'Pass' : 'Issues'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
