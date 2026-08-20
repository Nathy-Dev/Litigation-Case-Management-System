import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatNumber } from '@/lib/format';

/** Sequential brand-leaning palette shared by every chart in the app. */
export const CHART_COLOURS = [
  '#008751',
  '#00a862',
  '#0f766e',
  '#b8860b',
  '#1f6feb',
  '#6d28d9',
  '#b42318',
  '#6f7f7f',
];

const AXIS = { stroke: '#93a1a1', fontSize: 11 } as const;
const GRID = { stroke: '#e4e8e8', strokeDasharray: '3 3' } as const;

const tooltipStyle = {
  borderRadius: 10,
  border: '1px solid #dbe1e1',
  boxShadow: '0 8px 20px -8px rgb(14 18 18 / 0.18)',
  fontSize: 12,
  padding: '8px 10px',
} as const;

export function ChartFrame({ height = 260, children }: { height?: number; children: ReactNode }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children as never}
      </ResponsiveContainer>
    </div>
  );
}

interface CategoryDatum {
  label: string;
  value: number;
}

/** Horizontal bars — reads best for status, court tier and age buckets. */
export function CategoryBarChart({
  data,
  height = 260,
  colour = CHART_COLOURS[0],
  onSelect,
}: {
  data: CategoryDatum[];
  height?: number;
  colour?: string;
  onSelect?: (label: string) => void;
}) {
  return (
    <ChartFrame height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid {...GRID} horizontal={false} />
        <XAxis type="number" {...AXIS} allowDecimals={false} tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="label"
          {...AXIS}
          width={128}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value) => [formatNumber(Number(value)), 'Matters']}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.map((entry, index) => (
            <Cell
              key={entry.label}
              fill={colour}
              opacity={1 - index * 0.06}
              cursor={onSelect ? 'pointer' : undefined}
              onClick={() => onSelect?.(entry.label)}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

/** Donut for share-of-total questions. */
export function DonutChart({
  data,
  height = 240,
  centreLabel,
}: {
  data: CategoryDatum[];
  height?: number;
  centreLabel?: string;
}) {
  return (
    <div className="relative">
      <ChartFrame height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((entry, index) => (
              <Cell key={entry.label} fill={CHART_COLOURS[index % CHART_COLOURS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            iconSize={7}
            formatter={(value: string) => <span className="text-[11px] text-ink-600">{value}</span>}
          />
        </PieChart>
      </ChartFrame>
      {centreLabel && (
        <span className="pointer-events-none absolute inset-x-0 top-[38%] text-center font-serif text-[20px] font-semibold text-ink-900">
          {centreLabel}
        </span>
      )}
    </div>
  );
}

/** Filed vs concluded over the last twelve months. */
export function TrendChart({
  data,
  height = 250,
}: {
  data: Array<{ month: string; filed: number; concluded: number }>;
  height?: number;
}) {
  return (
    <ChartFrame height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="month" {...AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis {...AXIS} allowDecimals={false} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend
          verticalAlign="top"
          align="right"
          iconType="plainline"
          iconSize={16}
          formatter={(value: string) => <span className="text-[11px] text-ink-600">{value}</span>}
        />
        <Line
          type="monotone"
          dataKey="filed"
          name="Filed"
          stroke={CHART_COLOURS[0]}
          strokeWidth={2}
          dot={{ r: 2.5 }}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="concluded"
          name="Concluded"
          stroke={CHART_COLOURS[3]}
          strokeWidth={2}
          strokeDasharray="4 3"
          dot={{ r: 2.5 }}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ChartFrame>
  );
}

/** Grouped bars used by the workload-by-lawyer view. */
export function GroupedBarChart({
  data,
  series,
  height = 300,
}: {
  data: Array<Record<string, string | number>>;
  series: Array<{ key: string; label: string }>;
  height?: number;
}) {
  return (
    <ChartFrame height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="label" {...AXIS} tickLine={false} axisLine={false} interval={0} angle={-18} dy={8} height={46} />
        <YAxis {...AXIS} allowDecimals={false} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend
          verticalAlign="top"
          align="right"
          iconType="circle"
          iconSize={7}
          formatter={(value: string) => <span className="text-[11px] text-ink-600">{value}</span>}
        />
        {series.map((item, index) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            name={item.label}
            fill={CHART_COLOURS[index % CHART_COLOURS.length]}
            radius={[3, 3, 0, 0]}
            maxBarSize={18}
          />
        ))}
      </BarChart>
    </ChartFrame>
  );
}
