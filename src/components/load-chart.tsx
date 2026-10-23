import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { MetricChart } from "@/components/metric-chart";
import type { AbsoluteRange, HistoryPoint } from "@/lib/metrics";
import type { IncidentSummary } from "@/lib/diagnostics";
import {
  type LoadEvidence,
  type LoadContributor,
  loadContributors,
} from "@/lib/load-evidence";
import { pct } from "@/lib/format";

function contributorActivity(process: LoadContributor) {
  return [
    process.blocked ? "Waiting in kernel" : null,
    process.peakCpu !== null ? `CPU peak ${pct(process.peakCpu)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

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
  const contributors = evidence ? loadContributors(evidence) : [];
  const hoverContributors = hovered?.evidence
    ? loadContributors(hovered.evidence).slice(0, 3)
    : [];
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
            <ul className="space-y-1">
              {hoverContributors.map((process) => (
                <li key={process.pid}>
                  {process.name} · {contributorActivity(process)}
                </li>
              ))}
              {!hoverContributors.length && (
                <li className="text-muted-foreground">
                  No contributing processes captured.
                </li>
              )}
            </ul>
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
            <p className="text-[11px] text-muted-foreground">
              {selectedAt === null
                ? "Select a point on the graph."
                : `${pinned ? "Selected point" : "Highest load"} · ${new Date(selectedAt).toLocaleString()} · preceding minute`}
            </p>
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
              <ul className="divide-y" aria-label="Likely load contributors">
                {contributors.map((process) => (
                  <li
                    key={process.pid}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-xs first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-words">
                        <strong className="font-medium">{process.name}</strong>
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          PID {process.pid}
                        </span>
                      </p>
                      {process.service && (
                        <p
                          className="mt-0.5 truncate text-[10px] text-muted-foreground"
                          title={process.service}
                        >
                          {process.service}
                        </p>
                      )}
                    </div>
                    <span
                      className="text-[11px] text-muted-foreground"
                      title={
                        process.blocked
                          ? "Observed waiting in the kernel; may be causing contention or waiting behind another program."
                          : "Peak share of total CPU capacity in the preceding minute."
                      }
                    >
                      {contributorActivity(process)}
                    </span>
                  </li>
                ))}
                {!contributors.length && (
                  <li className="text-xs text-muted-foreground">
                    No contributing processes captured for this minute.
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </details>
    </MetricChart>
  );
}
