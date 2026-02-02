import { useState, useEffect } from 'react';
import type { ApiKeys } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKeys: ApiKeys;
  onSave: (keys: ApiKeys) => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  apiKeys,
  onSave,
}: SettingsModalProps) {
  const [keys, setKeys] = useState<ApiKeys>(apiKeys);

  // Sync local state when modal opens or apiKeys change
  useEffect(() => {
    if (isOpen) {
      setKeys(apiKeys);
    }
  }, [isOpen, apiKeys]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(keys);
    onClose();
  };

  const handleChange = (field: keyof ApiKeys, value: string) => {
    setKeys((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-gray-800 rounded-xl border border-gray-700 shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">API Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg
              className="w-6 h-6"
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
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-6">
          <p className="text-sm text-gray-400">
            Enter your API keys below. Keys are stored in memory only and will
            be cleared when you close the browser.
          </p>

          {/* Browserless */}
          <div>
            <label className="block text-sm font-medium text-purple-400 mb-2">
              Browserless
            </label>
            <input
              type="text"
              value={keys.browserless || ''}
              onChange={(e) => handleChange('browserless', e.target.value)}
              placeholder="API Key"
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Get your key at{' '}
              <a
                href="https://browserless.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:underline"
              >
                browserless.io
              </a>
            </p>
          </div>

          {/* URLBox */}
          <div>
            <label className="block text-sm font-medium text-blue-400 mb-2">
              URLBox
            </label>
            <div className="space-y-2">
              <input
                type="text"
                value={keys.urlboxKey || ''}
                onChange={(e) => handleChange('urlboxKey', e.target.value)}
                placeholder="API Key"
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              />
              <input
                type="text"
                value={keys.urlboxSecret || ''}
                onChange={(e) => handleChange('urlboxSecret', e.target.value)}
                placeholder="Secret"
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              />
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Get your keys at{' '}
              <a
                href="https://urlbox.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                urlbox.io
              </a>
            </p>
          </div>

          {/* ZenRows */}
          <div>
            <label className="block text-sm font-medium text-green-400 mb-2">
              ZenRows
            </label>
            <input
              type="text"
              value={keys.zenrows || ''}
              onChange={(e) => handleChange('zenrows', e.target.value)}
              placeholder="API Key"
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Get your key at{' '}
              <a
                href="https://zenrows.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-400 hover:underline"
              >
                zenrows.com
              </a>
            </p>
          </div>

          {/* Lambda */}
          <div>
            <label className="block text-sm font-medium text-orange-400 mb-2">
              AWS Lambda
            </label>
            <input
              type="text"
              value={keys.lambdaUrl || ''}
              onChange={(e) => handleChange('lambdaUrl', e.target.value)}
              placeholder="https://your-lambda-url.execute-api.region.amazonaws.com"
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent font-mono text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Deploy using the lambda/ folder in this project
            </p>
          </div>

          {/* Anthropic (for AI quality checks) */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Anthropic (optional, for AI quality checks)
            </label>
            <input
              type="text"
              value={keys.anthropic || ''}
              onChange={(e) => handleChange('anthropic', e.target.value)}
              placeholder="API Key"
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent font-mono text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Get your key at{' '}
              <a
                href="https://console.anthropic.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:underline"
              >
                console.anthropic.com
              </a>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-medium rounded-lg transition-all"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
