import { useMemo, memo, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { RaceResult, ScreenshotResult } from '../types';
import { PROVIDERS } from '../types';

interface RaceChartProps {
  results: RaceResult[];
  onHover: (result: ScreenshotResult | null) => void;
}

interface ChartDataItem {
  name: string;
  url: string;
  [key: string]: string | number | Record<string, ScreenshotResult> | undefined;
  results: Record<string, ScreenshotResult>;
}

function getProviderLabel(name: string): string {
  const provider = PROVIDERS.find(p => p.name === name);
  return provider?.label || name;
}

function truncateUrl(url: string, maxLength = 25): string {
  try {
    const parsed = new URL(url);
    let display = parsed.hostname.replace('www.', '');
    if (display.length > maxLength) {
      display = display.substring(0, maxLength - 3) + '...';
    }
    return display;
  } catch {
    return url.substring(0, maxLength);
  }
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const RaceChart = memo(function RaceChart({ results, onHover }: RaceChartProps) {
  // Memoize chart data transformation
  const chartData: ChartDataItem[] = useMemo(() => {
    return results.map((race) => {
      const item: ChartDataItem = {
        name: truncateUrl(race.url),
        url: race.url,
        results: {},
      };

      race.results.forEach((result) => {
        // Convert to seconds for cleaner display
        item[result.provider as keyof ChartDataItem] = result.success
          ? Math.round(result.timeMs)
          : 0;
        item.results[result.provider] = result;
      });

      return item;
    });
  }, [results]);

  const handleBarMouseEnter = useCallback((data: ChartDataItem, provider: string) => {
    const result = data.results[provider];
    if (result) {
      onHover(result);
    }
  }, [onHover]);

  if (results.length === 0) {
    return (
      <div className="w-full h-80 flex items-center justify-center text-gray-500">
        Run a race to see results
      </div>
    );
  }

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            axisLine={{ stroke: '#374151' }}
            tickLine={{ stroke: '#374151' }}
          />
          <YAxis
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            axisLine={{ stroke: '#374151' }}
            tickLine={{ stroke: '#374151' }}
            tickFormatter={(value) => formatTime(value)}
            label={{
              value: 'Response Time',
              angle: -90,
              position: 'insideLeft',
              fill: '#9ca3af',
              fontSize: 12,
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '8px',
              color: '#fff',
            }}
            formatter={(value, name) => [formatTime(value as number), getProviderLabel(name as string)]}
            labelFormatter={(label) => `URL: ${label}`}
          />
          <Legend
            wrapperStyle={{ paddingTop: '10px' }}
            formatter={(value) => <span style={{ color: '#d1d5db' }}>{getProviderLabel(value)}</span>}
          />
          {PROVIDERS.map((provider) => (
            <Bar
              key={provider.name}
              dataKey={provider.name}
              fill={provider.color}
              radius={[4, 4, 0, 0]}
              onMouseEnter={(data) => {
                if (data && data.payload) {
                  handleBarMouseEnter(data.payload as ChartDataItem, provider.name);
                }
              }}
              onMouseLeave={() => onHover(null)}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});
