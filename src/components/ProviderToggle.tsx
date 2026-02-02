import { PROVIDERS, isProviderConfigured, type ApiKeys, type ProviderName } from '../types';

interface ProviderToggleProps {
  enabledProviders: ProviderName[];
  apiKeys: ApiKeys;
  onToggle: (provider: ProviderName) => void;
}

export function ProviderToggle({
  enabledProviders,
  apiKeys,
  onToggle,
}: ProviderToggleProps) {
  return (
    <div className="flex flex-wrap gap-3 justify-center">
      {PROVIDERS.map((provider) => {
        const isConfigured = isProviderConfigured(provider.name, apiKeys);
        const isEnabled = enabledProviders.includes(provider.name);
        const isActive = isConfigured && isEnabled;

        return (
          <button
            key={provider.name}
            onClick={() => isConfigured && onToggle(provider.name)}
            disabled={!isConfigured}
            className={`px-4 py-2 rounded-lg border-2 transition-all duration-200 font-medium ${
              !isConfigured
                ? 'bg-transparent text-gray-600 border-gray-800 cursor-not-allowed opacity-50'
                : isActive
                  ? 'bg-opacity-20 text-white cursor-pointer'
                  : 'bg-transparent text-gray-500 border-gray-700 hover:border-gray-600 cursor-pointer'
            }`}
            style={{
              borderColor: isActive ? provider.color : undefined,
              backgroundColor: isActive ? `${provider.color}20` : undefined,
            }}
            title={!isConfigured ? 'API key not configured' : undefined}
          >
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  isConfigured ? (isActive ? '' : 'opacity-30') : 'opacity-20'
                }`}
                style={{ backgroundColor: isConfigured ? provider.color : '#4b5563' }}
              />
              <span>{provider.label}</span>
              {provider.isAsync && (
                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-cyan-900/50 text-cyan-400 rounded">
                  ASYNC
                </span>
              )}
              {!isConfigured && (
                <svg
                  className="w-4 h-4 text-gray-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
