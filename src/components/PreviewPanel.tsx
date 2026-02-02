import { memo } from 'react';
import type { ScreenshotResult } from '../types';
import { PROVIDERS } from '../types';

interface PreviewPanelProps {
  result: ScreenshotResult | null;
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const PreviewPanel = memo(function PreviewPanel({ result }: PreviewPanelProps) {
  if (!result) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-800 rounded-lg border border-gray-700">
        <p className="text-gray-500">Hover over a bar to preview screenshot</p>
      </div>
    );
  }

  const provider = PROVIDERS.find((p) => p.name === result.provider);
  const color = provider?.color || '#6b7280';

  return (
    <div className="w-full h-full flex flex-col bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      {/* Header */}
      <div
        className="px-4 py-3 border-b border-gray-700"
        style={{ borderTopColor: color, borderTopWidth: '3px' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="font-semibold capitalize text-white">
              {result.provider}
            </span>
          </div>
          {result.success ? (
            <span className="px-2 py-1 bg-green-900/50 text-green-400 rounded text-sm">
              Success
            </span>
          ) : (
            <span className="px-2 py-1 bg-red-900/50 text-red-400 rounded text-sm">
              Failed
            </span>
          )}
        </div>
      </div>

      {/* Metadata */}
      <div className="px-4 py-2 border-b border-gray-700 grid grid-cols-3 gap-4 text-sm">
        <div>
          <span className="text-gray-500">Time:</span>
          <span className="ml-2 text-white">{formatTime(result.timeMs)}</span>
        </div>
        {result.imageSize && (
          <div>
            <span className="text-gray-500">Size:</span>
            <span className="ml-2 text-white">
              {formatBytes(result.imageSize)}
            </span>
          </div>
        )}
        {result.quality && (
          <div>
            <span className="text-gray-500">Quality:</span>
            <span
              className={`ml-2 ${
                result.quality.passed ? 'text-green-400' : 'text-yellow-400'
              }`}
            >
              {result.quality.passed ? 'Passed' : 'Issues'}
            </span>
          </div>
        )}
      </div>

      {/* URL */}
      <div className="px-4 py-2 border-b border-gray-700">
        <span className="text-gray-500 text-sm">URL:</span>
        <p className="text-white text-sm font-mono truncate">{result.url}</p>
      </div>

      {/* Preview or Error */}
      <div className="flex-1 p-4 overflow-auto">
        {result.success && result.imageData ? (
          <img
            src={result.imageData}
            alt={`Screenshot of ${result.url}`}
            className="w-full h-auto rounded border border-gray-700"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center">
              <svg
                className="w-12 h-12 mx-auto text-red-500 mb-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <p className="text-red-400 font-medium">Screenshot Failed</p>
              {result.error && (
                <p className="text-gray-500 text-sm mt-1 max-w-xs">
                  {result.error}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Quality Details */}
      {result.quality && result.quality.details.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-700">
          <span className="text-gray-500 text-xs">Quality checks:</span>
          <ul className="mt-1 text-xs">
            {result.quality.details.map((detail, i) => (
              <li key={i} className="text-gray-400">
                {detail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});
