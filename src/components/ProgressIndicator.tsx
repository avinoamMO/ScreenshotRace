import { PROVIDERS, type ProviderName, type ScreenshotResult } from '../types';

interface ProgressIndicatorProps {
  currentUrl: string;
  completedProviders: ScreenshotResult[];
  enabledProviders: ProviderName[];
}

export function ProgressIndicator({
  currentUrl,
  completedProviders,
  enabledProviders,
}: ProgressIndicatorProps) {
  const completedSet = new Set(completedProviders.map((r) => r.provider));

  return (
    <div className="w-full max-w-2xl mx-auto bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-400 text-sm">Racing:</span>
        <span className="text-white text-sm font-mono truncate ml-2 max-w-md">
          {currentUrl}
        </span>
      </div>
      <div className="flex gap-2">
        {PROVIDERS.filter((p) => enabledProviders.includes(p.name)).map(
          (provider) => {
            const result = completedProviders.find(
              (r) => r.provider === provider.name
            );
            const isComplete = completedSet.has(provider.name);

            return (
              <div
                key={provider.name}
                className={`flex-1 rounded-lg p-2 transition-all duration-300 ${
                  isComplete ? '' : 'animate-pulse'
                }`}
                style={{
                  backgroundColor: isComplete
                    ? `${provider.color}40`
                    : `${provider.color}15`,
                  borderWidth: '1px',
                  borderColor: provider.color,
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-200">
                    {provider.label}
                  </span>
                  {isComplete ? (
                    result?.success ? (
                      <svg
                        className="w-4 h-4 text-green-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-4 h-4 text-red-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    )
                  ) : (
                    <svg
                      className="w-4 h-4 text-gray-400 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
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
                  )}
                </div>
              </div>
            );
          }
        )}
      </div>
    </div>
  );
}
