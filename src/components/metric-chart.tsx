import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { HistoryPoint } from "@/lib/metrics";
import { bytes } from "@/lib/format";

type Series = {
  key: "cpu" | "memory" | "disk" | "rx" | "tx";
  label: string;
  color: string;
};
export function MetricChart({
  title,
  description,
  data,
  series,
  unit = "percent",
  loading = false,
  children,
}: {
  title: string;
  description: string;
  data: HistoryPoint[];
  series: Series[];
  unit?: "percent" | "bytes";
  loading?: boolean;
  children?: React.ReactNode;
}) {
  const id = useId().replace(/:/g, "");
  const hasData = data.some((point) =>
    series.some((s) => point[s.key] !== null),
  );
  const formatValue = (value: number) =>
    unit === "percent" ? `${value.toFixed(1)}%` : `${bytes(value)}/s`;
  const longRange =
    data.length > 1 &&
    data[data.length - 1].timestamp - data[0].timestamp > 86400_000;
  const shortRange =
    data.length > 0 &&
    data[data.length - 1].timestamp - data[0].timestamp < 600_000;
  return (
    <Card className="min-w-0 gap-4 shadow-none">
      <CardHeader className="gap-1 px-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="flex gap-3 text-xs text-muted-foreground">
            {series.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: s.color }}
                />
                {s.label}
              </span>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="px-3 sm:px-4">
        <div
          className={`metric-chart relative h-[210px] min-w-0 ${loading ? "opacity-40" : ""}`}
          role="img"
          aria-label={`${title}: ${hasData ? `${data.length} chart points` : "waiting for measurements"}`}
        >
          {hasData ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart
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
                  domain={["dataMin", "dataMax"]}
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
                  domain={unit === "percent" ? [0, 100] : [0, "auto"]}
                  width={58}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickCount={5}
                  tickFormatter={(value) =>
                    unit === "percent" ? `${value}%` : bytes(value, 1)
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
                  formatter={(value, name) => [
                    typeof value === "number"
                      ? formatValue(value)
                      : "Unavailable",
                    String(name),
                  ]}
                />
                {series.map((s) => (
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
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                    connectNulls={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <span className="size-2 rounded-full bg-border" />
              <span>
                {loading ? "Loading history…" : "Waiting for measurements"}
              </span>
              <span className="text-xs">New samples appear automatically.</span>
            </div>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
