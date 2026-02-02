import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { UrlInput } from './components/UrlInput';
import { RaceChart } from './components/RaceChart';
import { PreviewPanel } from './components/PreviewPanel';
import { ProviderToggle } from './components/ProviderToggle';
import { SettingsModal } from './components/SettingsModal';
import { Stopwatch } from './components/Stopwatch';
import { ComparisonTable } from './components/ComparisonTable';
import { ProviderResultsGrid } from './components/ProviderResultsGrid';
import { HistoricalCharts } from './components/HistoricalCharts';
import { raceAllUrls } from './providers';
import { checkQuality } from './utils/qualityCheck';
import { Semaphore } from './utils/semaphore';
import { saveSession, type SessionResult } from './utils/sessionHistory';
import type { ApiKeys, ProviderName, RaceResult, ScreenshotResult } from './types';
import { PROVIDERS, isProviderConfigured } from './types';

const STORAGE_KEY = 'screenshot-race-api-keys';

function loadApiKeys(): ApiKeys {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function App() {
  const [apiKeys, setApiKeys] = useState<ApiKeys>(loadApiKeys);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [enabledProviders, setEnabledProviders] = useState<ProviderName[]>(
    PROVIDERS.map((p) => p.name)
  );
  const [isRacing, setIsRacing] = useState(false);
  const [results, setResults] = useState<RaceResult[]>([]);
  const [hoveredResult, setHoveredResult] = useState<ScreenshotResult | null>(
    null
  );
  const [totalProgress, setTotalProgress] = useState<{
    completed: number;
    total: number;
  }>({ completed: 0, total: 0 });
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Persist API keys to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(apiKeys));
  }, [apiKeys]);

  const configuredProviderCount = useMemo(
    () => PROVIDERS.filter((p) => isProviderConfigured(p.name, apiKeys)).length,
    [apiKeys]
  );

  const handleToggleProvider = useCallback((provider: ProviderName) => {
    setEnabledProviders((prev) =>
      prev.includes(provider)
        ? prev.filter((p) => p !== provider)
        : [...prev, provider]
    );
  }, []);

  const handleRace = useCallback(
    async (urls: string[]) => {
      // Filter to only enabled AND configured providers
      const activeProviders = enabledProviders.filter((p) =>
        isProviderConfigured(p, apiKeys)
      );

      if (activeProviders.length === 0) {
        setIsSettingsOpen(true);
        return;
      }

      // Create new AbortController for this race
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      setIsRacing(true);
      setResults([]);

      const totalJobs = urls.length * activeProviders.length;
      let completedJobs = 0;
      setTotalProgress({ completed: 0, total: totalJobs });

      // Track results as they come in
      const resultsMap = new Map<string, ScreenshotResult[]>();
      for (const url of urls) {
        resultsMap.set(url, []);
      }

      // Semaphore to limit concurrent quality checks (max 10 at once)
      const qualitySemaphore = new Semaphore(10);

      // Race ALL URLs in parallel with true async
      const finalResultsMap = await raceAllUrls(
        urls,
        activeProviders,
        apiKeys,
        async (result) => {
          if (signal.aborted) return;

          completedJobs++;
          setTotalProgress({ completed: completedJobs, total: totalJobs });

          // Run quality check (with semaphore to limit concurrent checks)
          let resultWithQuality = result;
          if (result.success) {
            const quality = await qualitySemaphore.withLock(() => checkQuality(result));
            resultWithQuality = { ...result, quality };
          }

          // Update results map
          const urlResults = resultsMap.get(result.url) || [];
          urlResults.push(resultWithQuality);
          resultsMap.set(result.url, urlResults);

          // Convert map to array and update state
          const raceResults: RaceResult[] = urls
            .map((url) => ({
              url,
              results: resultsMap.get(url) || [],
            }))
            .filter((r) => r.results.length > 0);

          setResults(raceResults);
        },
        signal
      );

      // Final update with all results
      const finalResults: RaceResult[] = urls.map((url) => {
        const urlResults = finalResultsMap.get(url) || [];
        return {
          url,
          results: urlResults,
        };
      });

      // Run quality checks on any results that don't have them yet (with semaphore)
      const resultsWithQuality = await Promise.all(
        finalResults.map(async (raceResult) => ({
          ...raceResult,
          results: await Promise.all(
            raceResult.results.map(async (result) => {
              if (result.success && !result.quality) {
                const quality = await qualitySemaphore.withLock(() => checkQuality(result));
                return { ...result, quality };
              }
              return result;
            })
          ),
        }))
      );

      setResults(resultsWithQuality);
      setTotalProgress({ completed: 0, total: 0 });
      setIsRacing(false);

      // Save session to history for charts
      const sessionResults: SessionResult[] = resultsWithQuality.flatMap(raceResult =>
        raceResult.results.map(result => ({
          timestamp: Date.now(),
          url: result.url,
          provider: result.provider,
          timeMs: result.timeMs,
          success: result.success,
          imageSize: result.imageSize,
        }))
      );
      if (sessionResults.length > 0) {
        saveSession(sessionResults);
        setHistoryRefreshKey(k => k + 1);
      }
    },
    [enabledProviders, apiKeys]
  );

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsRacing(false);
    setTotalProgress({ completed: 0, total: 0 });
  }, []);

  const handleClear = useCallback(() => {
    setResults([]);
    setHoveredResult(null);
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 py-6">
        <div className="container mx-auto px-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              ScreenshotRace
            </h1>
            <p className="text-gray-400 mt-1">
              Benchmark screenshot providers side-by-side
            </p>
          </div>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors"
          >
            <svg
              className="w-5 h-5 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <span className="text-gray-300">Settings</span>
            {configuredProviderCount > 0 && (
              <span className="px-2 py-0.5 bg-green-900/50 text-green-400 rounded text-xs">
                {configuredProviderCount}/{PROVIDERS.length}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="space-y-8">
          {/* Provider Toggle */}
          <section>
            <div className="flex items-center justify-center gap-2 mb-4">
              <h2 className="text-lg font-medium text-gray-300">Providers</h2>
              {configuredProviderCount === 0 && (
                <button
                  onClick={() => setIsSettingsOpen(true)}
                  className="text-sm text-purple-400 hover:text-purple-300"
                >
                  (configure API keys)
                </button>
              )}
            </div>
            <ProviderToggle
              enabledProviders={enabledProviders}
              apiKeys={apiKeys}
              onToggle={handleToggleProvider}
            />
          </section>

          {/* URL Input with Stopwatch */}
          <section>
            <div className="flex items-center justify-center gap-4 mb-4">
              <Stopwatch isRunning={isRacing} />
              {isRacing && (
                <button
                  onClick={handleStop}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                  Stop
                </button>
              )}
              {!isRacing && results.length > 0 && (
                <button
                  onClick={handleClear}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Clear
                </button>
              )}
            </div>
            <UrlInput
              onRace={handleRace}
              isRacing={isRacing}
              apiKeys={apiKeys}
              enabledProviders={enabledProviders}
            />
          </section>

          {/* Progress Indicator */}
          {isRacing && totalProgress.total > 0 && (
            <section className="w-full max-w-2xl mx-auto">
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400 text-sm">Progress</span>
                  <span className="text-white text-sm font-mono">
                    {totalProgress.completed} / {totalProgress.total}
                  </span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${(totalProgress.completed / totalProgress.total) * 100}%`,
                    }}
                  />
                </div>
                <p className="text-gray-500 text-xs mt-2 text-center">
                  All providers racing in parallel
                </p>
              </div>
            </section>
          )}

          {/* Results Section */}
          {results.length > 0 && (
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Chart */}
              <div className="lg:col-span-2 bg-gray-800 rounded-lg border border-gray-700 p-4">
                <h2 className="text-lg font-medium text-gray-300 mb-4">
                  Results
                </h2>
                <RaceChart results={results} onHover={setHoveredResult} />
              </div>

              {/* Preview Panel */}
              <div className="lg:col-span-1 h-[700px]">
                <PreviewPanel result={hoveredResult} />
              </div>
            </section>
          )}

          {/* Comparison Table */}
          {results.length > 0 && (
            <section>
              <ComparisonTable results={results} />
            </section>
          )}

          {/* Provider Results Grid - Images by Provider */}
          {results.length > 0 && (
            <section>
              <ProviderResultsGrid results={results} />
            </section>
          )}

          {/* Historical Performance Charts */}
          <section>
            <HistoricalCharts key={historyRefreshKey} />
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-4 mt-8">
        <div className="container mx-auto px-4 text-center text-gray-500 text-sm">
          ScreenshotRace - Compare screenshot providers
        </div>
      </footer>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        apiKeys={apiKeys}
        onSave={setApiKeys}
      />
    </div>
  );
}

export default App;
