import { memo, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import { PROVIDERS } from '../types';
import {
  loadSessionHistory,
  calculateProviderStats,
  getTimeSeriesData,
  clearSessionHistory,
} from '../utils/sessionHistory';

export const HistoricalCharts = memo(function HistoricalCharts() {
  const [refreshKey, setRefreshKey] = useState(0);

  const history = useMemo(() => loadSessionHistory(), [refreshKey]);
  const stats = useMemo(() => calculateProviderStats(history), [history]);
  const timeSeries = useMemo(() => getTimeSeriesData(history), [history]);

  const handleClearHistory = () => {
    if (confirm('Clear all session history?')) {
      clearSessionHistory();
      setRefreshKey(k => k + 1);
    }
  };

  if (history.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 text-center">
        <p className="text-gray-400">No historical data yet.</p>
        <p className="text-gray-500 text-sm mt-1">
          Run some races to see performance comparisons over time.
        </p>
      </div>
    );
  }

  const providerColorMap = Object.fromEntries(
    PROVIDERS.map(p => [p.name, p.color])
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-gray-300">
          Historical Performance ({history.length} sessions, {stats.reduce((a, s) => a + s.totalRuns, 0)} total runs)
        </h2>
        <button
          onClick={handleClearHistory}
          className="text-sm text-red-400 hover:text-red-300"
        >
          Clear History
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Average Time Comparison */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <h3 className="text-md font-medium text-gray-400 mb-4">
            Average Response Time by Provider
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={stats} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis type="number" stroke="#9ca3af" tickFormatter={(v) => `${(v/1000).toFixed(1)}s`} />
              <YAxis type="category" dataKey="provider" stroke="#9ca3af" width={100} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }}
                formatter={(value) => value != null ? [`${(Number(value)/1000).toFixed(2)}s`, 'Avg Time'] : null}
              />
              <Bar dataKey="avgTimeMs" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Success Rate */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <h3 className="text-md font-medium text-gray-400 mb-4">
            Success Rate by Provider
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={stats} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis type="number" stroke="#9ca3af" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="provider" stroke="#9ca3af" width={100} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }}
                formatter={(value) => value != null ? [`${Number(value).toFixed(1)}%`, 'Success Rate'] : null}
              />
              <Bar
                dataKey="successRate"
                fill="#22c55e"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Time Trend Over Sessions */}
        {timeSeries.length > 1 && (
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 lg:col-span-2">
            <h3 className="text-md font-medium text-gray-400 mb-4">
              Performance Trend Over Sessions
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={timeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="timestamp"
                  stroke="#9ca3af"
                  tickFormatter={(ts) => new Date(ts).toLocaleDateString()}
                />
                <YAxis
                  stroke="#9ca3af"
                  tickFormatter={(v) => `${(v/1000).toFixed(1)}s`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }}
                  labelFormatter={(ts) => new Date(Number(ts)).toLocaleString()}
                  formatter={(value) => value != null ? [`${(Number(value)/1000).toFixed(2)}s`] : null}
                />
                <Legend />
                {PROVIDERS.map(provider => (
                  <Line
                    key={provider.name}
                    type="monotone"
                    dataKey={provider.name}
                    name={provider.label}
                    stroke={provider.color}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Stats Table */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 lg:col-span-2">
          <h3 className="text-md font-medium text-gray-400 mb-4">
            Detailed Statistics
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="text-left py-2 px-3">Provider</th>
                  <th className="text-right py-2 px-3">Runs</th>
                  <th className="text-right py-2 px-3">Avg Time</th>
                  <th className="text-right py-2 px-3">Min Time</th>
                  <th className="text-right py-2 px-3">Max Time</th>
                  <th className="text-right py-2 px-3">Success %</th>
                  <th className="text-right py-2 px-3">Avg Size</th>
                </tr>
              </thead>
              <tbody>
                {stats.map(stat => (
                  <tr key={stat.provider} className="border-b border-gray-700/50">
                    <td className="py-2 px-3">
                      <span
                        className="inline-block w-3 h-3 rounded-full mr-2"
                        style={{ backgroundColor: providerColorMap[stat.provider] || '#888' }}
                      />
                      {stat.provider}
                    </td>
                    <td className="text-right py-2 px-3 font-mono text-gray-300">
                      {stat.totalRuns}
                    </td>
                    <td className="text-right py-2 px-3 font-mono text-gray-300">
                      {(stat.avgTimeMs / 1000).toFixed(2)}s
                    </td>
                    <td className="text-right py-2 px-3 font-mono text-green-400">
                      {(stat.minTimeMs / 1000).toFixed(2)}s
                    </td>
                    <td className="text-right py-2 px-3 font-mono text-red-400">
                      {(stat.maxTimeMs / 1000).toFixed(2)}s
                    </td>
                    <td className="text-right py-2 px-3 font-mono">
                      <span className={stat.successRate >= 90 ? 'text-green-400' : stat.successRate >= 70 ? 'text-yellow-400' : 'text-red-400'}>
                        {stat.successRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="text-right py-2 px-3 font-mono text-gray-300">
                      {stat.avgSizeKb > 0 ? `${stat.avgSizeKb.toFixed(0)}KB` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
});
