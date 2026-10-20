import { MetricChart } from "@/components/metric-chart";
import type { AbsoluteRange, ProcessHistory } from "@/lib/metrics";

const colors = [1, 2, 3, 4, 5].map((index) => `var(--chart-${index})`);
type Point = {
  timestamp: number;
  coverage: number[];
  samples: number;
} & Record<`p${number}`, number | null>;

export function ProcessChart({
  metric,
  history,
  window,
  loading,
  onZoom,
}: {
  metric: "cpu" | "memory";
  history?: ProcessHistory;
  window?: AbsoluteRange;
  loading: boolean;
  onZoom: (range: AbsoluteRange) => void;
}) {
  const series = history?.series ?? [];
  const data: Point[] = (history?.points ?? []).map((point) => ({
    timestamp: point.timestamp,
    samples: point.samples,
    coverage: point.coverage,
    ...Object.fromEntries(
      point.values.map((value, index) => [`p${index}`, value]),
    ),
  }));
  return (
    <MetricChart
      title={
        metric === "cpu" ? "Top processes · CPU" : "Top processes · Memory"
      }
      description={`Five highest recorded peaks in this range · % of ${metric === "cpu" ? "total CPU capacity" : "physical RAM (resident memory)"}`}
      data={data}
      series={series.map((process, index) => ({
        key: `p${index}` as const,
        label: `${process.name} · ${process.pid}`,
        color: colors[index],
      }))}
      variant="line"
      autoScale
      window={window}
      loading={loading}
      onZoom={onZoom}
      emptyMessage="No retained process readings in this time range"
      emptyHint="Process history starts with this update; older readings are unavailable."
      tooltipNote={(point, key) => {
        const count = point.coverage[Number(key.slice(1))] ?? 0;
        return count < point.samples
          ? ` · saved ${count}/${point.samples} samples`
          : "";
      }}
    >
      <div className="mt-4 border-t px-2 pt-3 text-[10px] leading-relaxed text-muted-foreground">
        <p>
          Top 20 CPU + top 20 memory processes saved each interval. Gaps are
          unknown, not zero.
        </p>
        <p>
          Zoom recalculates the top five. Wide ranges show peaks; zoom in for
          individual samples and gaps.
        </p>
        {metric === "memory" && (
          <p>Shared resident pages can be counted by more than one process.</p>
        )}
      </div>
    </MetricChart>
  );
}
