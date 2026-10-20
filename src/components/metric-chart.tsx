import { useId } from "react";
import {
  Area,
  AreaChart,
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { AbsoluteRange } from "@/lib/metrics";
import { ChartZoom } from "@/components/chart-zoom";
import { bytes } from "@/lib/format";

type Series<T> = {
  key: Exclude<keyof T, "timestamp"> & string;
  label: string;
  color: string;
};
export function MetricChart<T extends { timestamp: number }>({
  title,
  description,
  data,
  series,
  unit = "percent",
  loading = false,
  window,
  onZoom,
  emptyMessage,
  emptyHint,
  variant = "area",
  autoScale = false,
  tooltipNote,
  children,
}: {
  title: string;
  description: string;
  data: T[];
  series: Series<T>[];
  unit?: "percent" | "bytes" | "load" | "temperature";
  loading?: boolean;
  window?: AbsoluteRange;
  onZoom: (range: AbsoluteRange) => void;
  emptyMessage?: string;
  emptyHint?: string;
  variant?: "area" | "line";
  autoScale?: boolean;
  tooltipNote?: (point: T, key: string) => string;
  children?: React.ReactNode;
}) {
  const id = useId().replace(/:/g, "");
  const Chart = variant === "line" ? LineChart : AreaChart;
  const hasData = data.some((point) =>
    series.some((s) => point[s.key] != null),
  );
  const formatValue = (value: number) =>
    unit === "percent"
      ? `${value.toFixed(1)}%`
      : unit === "bytes"
        ? `${bytes(value)}/s`
        : unit === "temperature"
          ? `${value.toFixed(1)} °C`
          : value.toFixed(2);
  const longRange =
    data.length > 1 &&
    data[data.length - 1].timestamp - data[0].timestamp > 86400_000;
  const shortRange =
    data.length > 0 &&
    data[data.length - 1].timestamp - data[0].timestamp < 600_000;
  return (
    <Card className="min-w-0 gap-4 shadow-none">
      <CardHeader className="gap-1 px-5 sm:px-6">
        <div
          className={`flex flex-wrap gap-2 ${variant === "line" ? "flex-col items-start" : "items-center justify-between"}`}
        >
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="flex max-w-full flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            {series.map((s) => (
              <span
                key={s.key}
                className="flex min-w-0 max-w-full items-center gap-1.5"
                title={s.label}
              >
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="truncate">{s.label}</span>
              </span>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="px-3 sm:px-4">
        <div
          className={`metric-chart relative h-[210px] min-w-0 select-none ${loading ? "opacity-40" : ""}`}
          role="img"
          aria-label={`${title}: ${hasData ? `${data.length} chart points` : "waiting for measurements"}`}
        >
          {hasData ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <Chart
                data={data}
                margin={{ top: 10, right: 12, bottom: 0, left: 0 }}
                accessibilityLayer
              >
                <defs>
                  {series.map((s) => (
                    <linearGradient
                      id={`${id}-${s.key}`}
                      key={s.key}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={s.color}
                        stopOpacity={0.16}
                      />
                      <stop
                        offset="100%"
                        stopColor={s.color}
                        stopOpacity={0.01}
                      />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 4" />
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  domain={
                    window ? [window.from, window.to] : ["dataMin", "dataMax"]
                  }
                  allowDataOverflow
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                  tickMargin={10}
                  tickFormatter={(value) =>
                    new Date(value).toLocaleString(
                      undefined,
                      longRange
                        ? {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            hourCycle: "h23",
                          }
                        : {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: shortRange ? "2-digit" : undefined,
                            hourCycle: "h23",
                          },
                    )
                  }
                />
                <YAxis
                  domain={
                    unit === "percent" && !autoScale ? [0, 100] : [0, "auto"]
                  }
                  width={58}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickCount={5}
                  tickFormatter={(value) =>
                    unit === "percent"
                      ? `${value}%`
                      : unit === "bytes"
                        ? bytes(value, 1)
                        : unit === "temperature"
                          ? `${value}°`
                          : String(value)
                  }
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 10,
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    color: "var(--popover-foreground)",
                    fontSize: 12,
                  }}
                  labelFormatter={(value) =>
                    new Date(Number(value)).toLocaleString()
                  }
                  formatter={(value, name, item) => [
                    typeof value === "number"
                      ? `${formatValue(value)}${tooltipNote ? tooltipNote(item.payload as T, String(item.dataKey)) : ""}`
                      : "Unavailable",
                    String(name),
                  ]}
                />
                {variant === "line"
                  ? series.map((s) => (
                      <Line
                        key={s.key}
                        dataKey={s.key}
                        name={s.label}
                        type="linear"
                        stroke={s.color}
                        strokeWidth={1.8}
                        isAnimationActive={false}
                        dot={{ r: 1.5, fill: s.color, strokeWidth: 0 }}
                        activeDot={{
                          r: 4,
                          strokeWidth: 2,
                          stroke: "var(--card)",
                        }}
                        connectNulls={false}
                      />
                    ))
                  : series.map((s) => (
                      <Area
                        key={s.key}
                        dataKey={s.key}
                        name={s.label}
                        type="linear"
                        stroke={s.color}
                        strokeWidth={1.8}
                        fill={`url(#${id}-${s.key})`}
                        isAnimationActive={false}
                        dot={data.length === 1 ? { r: 3 } : false}
                        activeDot={{
                          r: 4,
                          strokeWidth: 2,
                          stroke: "var(--card)",
                        }}
                        connectNulls={false}
                      />
                    ))}
                <ChartZoom
                  title={title}
                  onZoom={onZoom}
                  enabled={!loading && data.length > 1}
                />
              </Chart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center text-sm text-muted-foreground">
              <span className="size-2 rounded-full bg-border" />
              <span>
                {loading
                  ? "Loading history…"
                  : (emptyMessage ?? "No samples in this time range")}
              </span>
              <span className="text-xs">
                {emptyHint ??
                  (emptyMessage
                    ? "Sensor availability depends on this host."
                    : "New samples appear automatically.")}
              </span>
            </div>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
