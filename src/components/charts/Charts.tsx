import type { ReactNode } from 'react';
import { BarChart3 } from 'lucide-react';
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
import { useReducedMotion } from '@/hooks/useReducedMotion';

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

/**
 * What a chart shows when it has nothing to plot. Recharts still draws axes and
 * an empty grid for an empty series, which reads as a chart that failed to load
 * rather than one with no data — so the frame is replaced outright, at the same
 * height, to stop the surrounding card resizing as data arrives.
 */
export function ChartEmpty({
  height = 260,
  message = 'Nothing to plot yet.',
}: {
  height?: number;
  message?: string;
}) {
  return (
    <div
      style={{ height }}
      className="grid w-full place-items-center rounded-lg border border-dashed border-ink-200 bg-ink-50/50 px-6 text-center"
    >
      <div>
        <BarChart3 className="mx-auto size-5 text-ink-300" aria-hidden />
        <p className="mt-2 text-[12px] leading-snug text-ink-500">{message}</p>
      </div>
    </div>
  );
}

/**
 * Draw-in animation for a data series, switched off when the viewer has asked
 * for less motion. Recharts animates SVG attributes from JavaScript, so the
 * stylesheet's reduced-motion rule cannot reach it — each series has to be told.
 */
function useSeriesMotion() {
  const reduced = useReducedMotion();
  return { isAnimationActive: !reduced, animationDuration: 450 } as const;
}

/**
 * A series of all zeroes plots as a row of invisible bars against a live axis,
 * so it counts as nothing to plot rather than as data.
 */
const isFlat = (values: number[]) => values.every((value) => !value);

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
  emptyMessage,
}: {
  data: CategoryDatum[];
  height?: number;
  colour?: string;
  onSelect?: (label: string) => void;
  emptyMessage?: string;
}) {
  const motion = useSeriesMotion();

  if (isFlat(data.map((entry) => entry.value))) {
    return <ChartEmpty height={height} message={emptyMessage} />;
  }

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
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22} {...motion}>
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
  emptyMessage,
}: {
  data: CategoryDatum[];
  height?: number;
  centreLabel?: string;
  emptyMessage?: string;
}) {
  const motion = useSeriesMotion();

  if (isFlat(data.map((entry) => entry.value))) {
    return <ChartEmpty height={height} message={emptyMessage} />;
  }

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
            {...motion}
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
            // The count rides in the label because the slices are told apart by
            // colour alone otherwise, and two of the palette greens are close
            // enough to be one colour in print (WCAG 1.4.1).
            formatter={(value: string) => (
              <span className="text-[11px] text-ink-600">
                {value}{' '}
                <span className="tnum font-semibold text-ink-800">
                  {formatNumber(data.find((entry) => entry.label === value)?.value ?? 0)}
                </span>
              </span>
            )}
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
  emptyMessage,
}: {
  data: Array<{ month: string; filed: number; concluded: number }>;
  height?: number;
  emptyMessage?: string;
}) {
  const motion = useSeriesMotion();

  if (isFlat(data.flatMap((point) => [point.filed, point.concluded]))) {
    return <ChartEmpty height={height} message={emptyMessage} />;
  }

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
          {...motion}
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
          {...motion}
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
  emptyMessage,
}: {
  data: Array<Record<string, string | number>>;
  series: Array<{ key: string; label: string }>;
  height?: number;
  emptyMessage?: string;
}) {
  const motion = useSeriesMotion();

  if (isFlat(data.flatMap((row) => series.map((item) => Number(row[item.key]) || 0)))) {
    return <ChartEmpty height={height} message={emptyMessage} />;
  }

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
            {...motion}
          />
        ))}
      </BarChart>
    </ChartFrame>
  );
}
