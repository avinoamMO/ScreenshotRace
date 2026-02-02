import { useState, useCallback, useRef } from 'react';
import { UrlInput } from './components/UrlInput';
import { RaceChart } from './components/RaceChart';
import { PreviewPanel } from './components/PreviewPanel';
import { ProviderToggle } from './components/ProviderToggle';
import { ProgressIndicator } from './components/ProgressIndicator';
import { SettingsModal } from './components/SettingsModal';
import { Stopwatch } from './components/Stopwatch';
import { ComparisonTable } from './components/ComparisonTable';
import { raceProviders } from './providers';
import { checkQuality } from './utils/qualityCheck';
import type { ApiKeys, ProviderName, RaceResult, ScreenshotResult } from './types';
import { PROVIDERS, isProviderConfigured } from './types';

function App() {
  const [apiKeys, setApiKeys] = useState<ApiKeys>({});
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [enabledProviders, setEnabledProviders] = useState<ProviderName[]>(
    PROVIDERS.map((p) => p.name)
  );
  const [isRacing, setIsRacing] = useState(false);
  const [results, setResults] = useState<RaceResult[]>([]);
  const [hoveredResult, setHoveredResult] = useState<ScreenshotResult | null>(
    null
  );
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [currentProgress, setCurrentProgress] = useState<ScreenshotResult[]>(
    []
  );
  const stopRaceRef = useRef(false);

  const configuredProviderCount = PROVIDERS.filter((p) =>
    isProviderConfigured(p.name, apiKeys)
  ).length;

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

      stopRaceRef.current = false;
      setIsRacing(true);
      setResults([]);

      const allResults: RaceResult[] = [];

      for (const url of urls) {
        if (stopRaceRef.current) break;

        setCurrentUrl(url);
        setCurrentProgress([]);

        const urlResults = await raceProviders(
          url,
          activeProviders,
          apiKeys,
          (result) => {
            setCurrentProgress((prev) => [...prev, result]);
          }
        );

        if (stopRaceRef.current) break;

        // Run quality checks
        const resultsWithQuality = await Promise.all(
          urlResults.map(async (result) => {
            if (result.success) {
              const quality = await checkQuality(result);
              return { ...result, quality };
            }
            return result;
          })
        );

        const raceResult: RaceResult = {
          url,
          results: resultsWithQuality,
        };

        allResults.push(raceResult);
        setResults([...allResults]);
      }

      setCurrentUrl('');
      setCurrentProgress([]);
      setIsRacing(false);
    },
    [enabledProviders, apiKeys]
  );

  const handleStop = useCallback(() => {
    stopRaceRef.current = true;
    setIsRacing(false);
    setCurrentUrl('');
    setCurrentProgress([]);
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
            </div>
            <UrlInput
              onRace={handleRace}
              isRacing={isRacing}
              apiKeys={apiKeys}
              enabledProviders={enabledProviders}
            />
          </section>

          {/* Progress Indicator */}
          {isRacing && currentUrl && (
            <section>
              <ProgressIndicator
                currentUrl={currentUrl}
                completedProviders={currentProgress}
                enabledProviders={enabledProviders.filter((p) =>
                  isProviderConfigured(p, apiKeys)
                )}
              />
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
              <div className="lg:col-span-1 h-[500px]">
                <PreviewPanel result={hoveredResult} />
              </div>
            </section>
          )}

          {/* Comparison Table */}
          {results.length > 0 && !isRacing && (
            <section>
              <ComparisonTable results={results} />
            </section>
          )}
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
