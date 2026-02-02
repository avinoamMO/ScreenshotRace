import type { RaceResult } from '../types';
import { PROVIDERS } from '../types';

interface ComparisonTableProps {
  results: RaceResult[];
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

export function ComparisonTable({ results }: ComparisonTableProps) {
  // Get all providers that have results
  const activeProviders = PROVIDERS.filter((provider) =>
    results.some((r) => r.results.some((res) => res.provider === provider.name))
  );

  // Calculate stats per provider
  const providerStats = activeProviders.map((provider) => {
    const allResults = results.flatMap((r) =>
      r.results.filter((res) => res.provider === provider.name)
    );
    const successfulResults = allResults.filter((r) => r.success);
    const failedResults = allResults.filter((r) => !r.success);

    const avgTime =
      successfulResults.length > 0
        ? successfulResults.reduce((sum, r) => sum + r.timeMs, 0) / successfulResults.length
        : 0;

    const minTime =
      successfulResults.length > 0
        ? Math.min(...successfulResults.map((r) => r.timeMs))
        : 0;

    const maxTime =
      successfulResults.length > 0
        ? Math.max(...successfulResults.map((r) => r.timeMs))
        : 0;

    const avgSize =
      successfulResults.filter((r) => r.imageSize).length > 0
        ? successfulResults
            .filter((r) => r.imageSize)
            .reduce((sum, r) => sum + (r.imageSize || 0), 0) /
          successfulResults.filter((r) => r.imageSize).length
        : 0;

    return {
      provider,
      total: allResults.length,
      successful: successfulResults.length,
      failed: failedResults.length,
      successRate: allResults.length > 0 ? (successfulResults.length / allResults.length) * 100 : 0,
      avgTime,
      minTime,
      maxTime,
      avgSize,
    };
  });

  // Find the fastest provider
  const fastestAvg = Math.min(...providerStats.filter((s) => s.avgTime > 0).map((s) => s.avgTime));

  if (results.length === 0) {
    return null;
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-700">
        <h2 className="text-lg font-semibold text-white">Provider Comparison</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-900/50">
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Provider
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                Success Rate
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                Avg Time
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                Min Time
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                Max Time
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                Avg Size
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {providerStats.map((stat) => {
              const isFastest = stat.avgTime === fastestAvg && stat.avgTime > 0;

              return (
                <tr key={stat.provider.name} className="hover:bg-gray-700/50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: stat.provider.color }}
                      />
                      <span className="font-medium text-white">
                        {stat.provider.label}
                      </span>
                      {stat.provider.isAsync && (
                        <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-cyan-900/50 text-cyan-400 rounded">
                          ASYNC
                        </span>
                      )}
                      {isFastest && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-green-900/50 text-green-400 rounded-full">
                          Fastest
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <div className="flex flex-col items-center">
                      <span
                        className={`font-semibold ${
                          stat.successRate === 100
                            ? 'text-green-400'
                            : stat.successRate >= 50
                            ? 'text-yellow-400'
                            : 'text-red-400'
                        }`}
                      >
                        {stat.successRate.toFixed(0)}%
                      </span>
                      <span className="text-xs text-gray-500">
                        {stat.successful}/{stat.total}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <span className={`font-mono ${isFastest ? 'text-green-400 font-semibold' : 'text-gray-300'}`}>
                      {stat.avgTime > 0 ? formatTime(stat.avgTime) : '-'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center font-mono text-gray-300">
                    {stat.minTime > 0 ? formatTime(stat.minTime) : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center font-mono text-gray-300">
                    {stat.maxTime > 0 ? formatTime(stat.maxTime) : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center font-mono text-gray-300">
                    {stat.avgSize > 0 ? formatBytes(stat.avgSize) : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
