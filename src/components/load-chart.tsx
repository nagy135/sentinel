import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { MetricChart } from "@/components/metric-chart";
import type { AbsoluteRange, HistoryPoint } from "@/lib/metrics";
import type { IncidentSummary } from "@/lib/diagnostics";
import { type LoadEvidence, workloadName } from "@/lib/load-evidence";
import { pct } from "@/lib/format";

const cache = new Map<number, { savedAt: number; evidence: LoadEvidence }>();
function useLoadEvidence(at: number | null, refreshKey: number, delay = 0) {
  const [result, setResult] = useState<{
    at: number;
    evidence?: LoadEvidence;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (at === null) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      const cached = cache.get(at);
      if (cached && Date.now() - cached.savedAt < 10_000) {
        setResult({ at, evidence: cached.evidence });
        return;
      }
      void (async () => {
        try {
          const response = await fetch(`/api/load-evidence?at=${at}`, {
            signal: abort.signal,
            cache: "no-store",
          });
          if (response.status === 401) {
            location.replace("/login");
            return;
          }
          if (!response.ok)
            throw new Error(
              "Could not load process evidence. Select the point to retry.",
            );
          const evidence: LoadEvidence = await response.json();
          if (abort.signal.aborted) return;
          cache.set(at, { savedAt: Date.now(), evidence });
          while (cache.size > 24) cache.delete(cache.keys().next().value!);
          setResult({ at, evidence });
        } catch (error) {
          if (!abort.signal.aborted)
            setResult({
              at,
              error:
                error instanceof Error
                  ? error.message
                  : "Could not load process evidence.",
            });
        }
      })();
    }, delay);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [at, refreshKey, delay]);
  return result?.at === at ? result : null;
}
function recordedWindows(
  incidents: IncidentSummary[],
  window?: AbsoluteRange,
): AbsoluteRange[] {
  const windows = incidents
    .map((i) => ({
      from: Math.max(i.startedAt, window?.from ?? 0),
      to: Math.min(i.endedAt, window?.to ?? Infinity),
    }))
    .filter((i) => i.from < i.to)
    .sort((a, b) => a.from - b.from);
  const merged: AbsoluteRange[] = [];
  for (const range of windows) {
    const last = merged.at(-1);
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}
export function LoadChart({
  history,
  window,
  loading,
  incidents,
  cores,
  now,
  onZoom,
}: {
  history: HistoryPoint[];
  window?: AbsoluteRange;
  loading: boolean;
  incidents: IncidentSummary[];
  cores?: number;
  now: number;
  onZoom: (range: AbsoluteRange) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pinnedAt, setPinnedAt] = useState<number | null>(null);
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const peak = history.reduce<HistoryPoint | null>(
    (best, p) =>
      p.load1 !== null && (!best || p.load1 > best.load1!) ? p : best,
    null,
  );
  const pinned =
    pinnedAt !== null &&
    (!window || (pinnedAt >= window.from && pinnedAt <= window.to));
  const selectedAt = loading
    ? null
    : pinned
      ? pinnedAt
      : (peak?.timestamp ?? null);
  const refreshKey = Math.floor(now / 10_000) + retry;
  const selected = useLoadEvidence(expanded ? selectedAt : null, refreshKey);
  const hovered = useLoadEvidence(loading ? null : hoverAt, refreshKey, 200);
  const evidence = selected?.evidence;
  function inspect(timestamp: number) {
    const closest = history.reduce<HistoryPoint | null>(
      (best, p) =>
        !best ||
        Math.abs(p.timestamp - timestamp) < Math.abs(best.timestamp - timestamp)
          ? p
          : best,
      null,
    );
    if (closest) {
      setPinnedAt(closest.timestamp);
      setRetry((n) => n + 1);
    }
  }
  return (
    <MetricChart
      title="System load"
      description="Runnable and waiting tasks · hover for processes"
      data={history}
      unit="load"
      loading={loading}
      window={window}
      onZoom={onZoom}
      onInspect={inspect}
      onHover={setHoverAt}
      evidenceWindows={recordedWindows(incidents, window)}
      tooltipExtra={
        <div className="mt-2 space-y-1 border-t pt-2">
          <p className="font-medium">Processes in the preceding minute</p>
          {!hovered ? (
            <p className="text-muted-foreground">Loading recorded tasks…</p>
          ) : hovered.error ? (
            <p>{hovered.error}</p>
          ) : hovered.evidence ? (
            <>
              {hovered.evidence.blockedTasks.slice(0, 2).map((task) => (
                <p key={task.id} className="break-words">
                  {task.name} · PID {task.pid} · blocked {task.observations}/
                  {hovered.evidence!.readings} readings
                  {workloadName(task.cgroup) && (
                    <span className="block text-muted-foreground">
                      {workloadName(task.cgroup)}
                    </span>
                  )}
                </p>
              ))}
              {!hovered.evidence.blockedTasks.length && (
                <p className="text-muted-foreground">
                  {hovered.evidence.readings
                    ? "No blocked threads captured."
                    : "No saved task recording for this minute."}
                </p>
              )}
              {!!hovered.evidence.busyProcesses.length && (
                <p>
                  Top CPU: {hovered.evidence.busyProcesses[0].name} ·{" "}
                  {pct(hovered.evidence.busyProcesses[0].peakCpu)}
                </p>
              )}
              {hovered.evidence.peakIoWait !== null && (
                <p>I/O wait peak: {pct(hovered.evidence.peakIoWait)}</p>
              )}
            </>
          ) : null}
          <p className="pt-1 text-muted-foreground">
            Click to select this point, then expand Process details.
          </p>
        </div>
      }
      series={[
        { key: "load1", label: "1m", color: "var(--chart-1)" },
        { key: "load5", label: "5m", color: "var(--chart-2)" },
        { key: "load15", label: "15m", color: "var(--chart-3)" },
      ]}
    >
      <details
        className="group mt-4 border-t px-2 pt-4"
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[10px] text-muted-foreground [&::-webkit-details-marker]:hidden">
          <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-foreground">
            <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
            Process details
          </span>
          <span className="text-right">
            {cores ?? "—"} cores · recorded periods shaded
          </span>
        </summary>
        {expanded && (
          <div className="mt-4 space-y-3" aria-label="Load process evidence">
            <div>
              <h3 className="text-xs font-semibold">
                What was happening here?
              </h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {selectedAt === null
                  ? "Select a recorded point."
                  : `${pinned ? "Selected point" : "Highest plotted load"} · ${new Date(selectedAt).toLocaleString()}`}
              </p>
            </div>
            {selectedAt !== null && !selected && (
              <p role="status" className="text-xs text-muted-foreground">
                Loading processes around this spike…
              </p>
            )}
            {selected?.error && (
              <p role="alert" className="text-xs text-destructive">
                {selected.error}
              </p>
            )}
            {evidence && (
              <>
                <p className="text-[11px] text-muted-foreground">
                  Evidence from the 60 seconds leading up to this point. Load is
                  averaged, so the work can precede its peak.
                </p>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                  <span>
                    I/O wait peak{" "}
                    <strong className="font-mono">
                      {pct(evidence.peakIoWait)}
                    </strong>
                  </span>
                  <span>
                    Blocked tasks peak{" "}
                    <strong className="font-mono">
                      {evidence.peakBlocked ?? "Unknown"}
                    </strong>
                  </span>
                  <span className="text-muted-foreground">
                    {evidence.readings} diagnostic readings
                  </span>
                </div>
                <div className="space-y-2">
                  <h4 className="text-xs font-medium">
                    Processes waiting in the kernel
                  </h4>
                  {evidence.blockedTasks.length ? (
                    <ul className="space-y-2 text-xs">
                      {evidence.blockedTasks.map((task) => (
                        <li
                          key={task.id}
                          className="flex flex-wrap justify-between gap-x-3 gap-y-1 rounded-md bg-muted/40 p-2.5"
                        >
                          <div className="min-w-0">
                            <p className="break-words">
                              <strong>{task.name}</strong>{" "}
                              <span className="font-mono text-muted-foreground">
                                PID {task.pid} / TID {task.tid}
                              </span>
                            </p>
                            <p className="mt-1 break-all text-[11px] text-muted-foreground">
                              {workloadName(task.cgroup) ??
                                "Service unavailable"}
                              {task.waits.length
                                ? ` · ${task.waits.join(", ")}`
                                : " · Wait location unavailable"}
                            </p>
                          </div>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            Blocked in {task.observations}/{evidence.readings}{" "}
                            readings
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {evidence.readings
                        ? "No blocked threads were captured in this minute."
                        : "No saved diagnostic readings cover this minute. Older spikes may have CPU history only."}
                    </p>
                  )}
                </div>
                {!!evidence.busyProcesses.length && (
                  <div className="space-y-1.5 border-t pt-3">
                    <h4 className="text-xs font-medium">
                      Busiest CPU processes
                    </h4>
                    <p className="text-[10px] text-muted-foreground">
                      Peak percentage of total CPU capacity in this minute.
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      {evidence.busyProcesses.map((p) => (
                        <span key={p.id}>
                          {p.name}{" "}
                          <span className="font-mono text-muted-foreground">
                            {p.pid} · {pct(p.peakCpu)}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {!!evidence.disks.length && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      Disk evidence
                    </summary>
                    <div className="mt-2 space-y-1">
                      {evidence.disks.map((d) => (
                        <p key={d.device}>
                          {d.device} · peak latency{" "}
                          {d.peakLatencyMs === null
                            ? "unknown"
                            : `${d.peakLatencyMs.toFixed(1)} ms`}{" "}
                          · peak queue {d.peakQueue?.toFixed(1) ?? "unknown"}
                        </p>
                      ))}
                    </div>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Peaks may occur in different samples. Devices and
                      partitions can overlap.
                    </p>
                  </details>
                )}
                {!!evidence.warnings.length && (
                  <details className="text-[11px] text-muted-foreground">
                    <summary className="cursor-pointer">
                      Missing or limited evidence ({evidence.warnings.length})
                    </summary>
                    <p className="mt-1 break-words">
                      {evidence.warnings.join(" · ")}
                    </p>
                  </details>
                )}
                <p className="border-t pt-3 text-[10px] text-muted-foreground">
                  These are observed workloads. A blocked process may be causing
                  I/O or waiting behind another workload.
                </p>
              </>
            )}
          </div>
        )}
      </details>
    </MetricChart>
  );
}
