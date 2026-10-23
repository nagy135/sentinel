import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetricChart } from "@/components/metric-chart";
import type { AbsoluteRange } from "@/lib/metrics";
import type {
  DiagnosticStatus,
  IncidentDetail,
  DiagnosticSample,
  BlockedThread,
} from "@/lib/diagnostics";
import { pct, rate } from "@/lib/format";

const time = (value: number) => new Date(value).toLocaleString();
const value = (n: number | null | undefined, unit = "") =>
  n == null ? "Unavailable" : `${n.toFixed(1)}${unit}`;

export function IncidentPanel({
  status,
  focusAt,
  onShowRange,
}: {
  status?: DiagnosticStatus;
  focusAt: { timestamp: number } | null;
  onShowRange: (range: AbsoluteRange) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [point, setPoint] = useState<number | null>(null);
  const [window, setWindow] = useState<AbsoluteRange | undefined>();
  const summary = status?.incidents.find((item) => item.id === selected);
  useEffect(() => {
    if (!focusAt) return;
    const match = status?.incidents.find(
      (item) =>
        item.startedAt <= focusAt.timestamp &&
        item.endedAt >= focusAt.timestamp,
    );
    setSelected(match?.id ?? null);
    setError(
      match
        ? null
        : "No saved incident covers this time. Recording starts only after this version is running and a trigger is detected.",
    );
    document
      .getElementById("load-incidents")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusAt]);
  useEffect(() => {
    setPoint(null);
    setWindow(undefined);
    setDetail(null);
  }, [selected]);
  useEffect(() => {
    if (selected === null) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/incidents?id=${selected}`, {
          signal: abort.signal,
          cache: "no-store",
        });
        if (response.status === 401) {
          location.replace("/login");
          return;
        }
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "This incident has expired."
              : "Could not load the incident.",
          );
        const next: IncidentDetail = await response.json();
        if (!abort.signal.aborted) {
          setDetail(next);
          setError(null);
        }
      } catch (e) {
        if (!abort.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Could not load the incident.",
          );
      }
    })();
    return () => abort.abort();
  }, [selected, summary?.endedAt, summary?.status]);
  useEffect(() => {
    if (!focusAt || !detail || detail.id !== selected) return;
    const closest = detail.readings.reduce<DiagnosticSample | null>(
      (best, r) =>
        !best ||
        Math.abs(r.timestamp - focusAt.timestamp) <
          Math.abs(best.timestamp - focusAt.timestamp)
          ? r
          : best,
      null,
    );
    if (closest) setPoint(closest.timestamp);
  }, [detail?.id, focusAt, selected]);
  const latest = status?.latest;
  const stale = latest && Date.now() - latest.timestamp > 15_000;
  const readings = detail?.id === selected ? detail.readings : [];
  const visible = window
    ? readings.filter(
        (r) => r.timestamp >= window.from && r.timestamp <= window.to,
      )
    : readings;
  // Insert gaps when sampling was interrupted rather than joining across an outage.
  const timeline = visible.flatMap((r, i) => {
    const item = {
      timestamp: r.timestamp,
      load: r.load,
      blocked: r.blocked,
      runnable: r.runnable,
      cpu: r.pressure.cpu?.some ?? null,
      memory: r.pressure.memory?.some ?? null,
      io: r.pressure.io?.some ?? null,
      busy: r.cpu.busy,
      iowait: r.cpu.iowait,
      steal: r.cpu.steal,
      swapIn: r.swapIn,
      swapOut: r.swapOut,
      majorFaults: r.majorFaults,
    };
    return i && r.timestamp - visible[i - 1].timestamp > 2500
      ? [
          Object.fromEntries(
            Object.keys(item).map((key) => [
              key,
              key === "timestamp" ? visible[i - 1].timestamp + 1000 : null,
            ]),
          ) as typeof item,
          item,
        ]
      : [item];
  });
  const threads = new Map<
    string,
    BlockedThread & { observations: number; waits: Set<string> }
  >();
  for (const reading of visible)
    for (const thread of reading.threads) {
      const existing = threads.get(thread.id) ?? {
        ...thread,
        observations: 0,
        waits: new Set<string>(),
      };
      existing.observations++;
      existing.waits.add(thread.wait ?? "Unavailable");
      threads.set(thread.id, existing);
    }
  const ranked = [...threads.values()].sort(
    (a, b) => b.observations - a.observations,
  );
  const current =
    point === null
      ? visible.at(-1)
      : (visible.find((r) => r.timestamp === point) ?? visible.at(-1));
  const warnings = [...new Set(visible.flatMap((r) => r.warnings))];
  const chartWindow =
    window ??
    (detail
      ? {
          from: detail.startedAt,
          to: Math.max(detail.endedAt, detail.startedAt + 1000),
        }
      : undefined);
  function select(id: number) {
    setError(null);
    setSelected(id);
  }
  function inspect(timestamp: number) {
    const closest = visible.reduce<DiagnosticSample | undefined>(
      (best, r) =>
        !best ||
        Math.abs(timestamp - r.timestamp) < Math.abs(timestamp - best.timestamp)
          ? r
          : best,
      undefined,
    );
    if (closest) setPoint(closest.timestamp);
  }
  return (
    <section
      id="load-incidents"
      aria-label="Load incident recorder"
      className="scroll-mt-5 space-y-4"
    >
      <Card className="shadow-none">
        <CardContent className="space-y-4 px-5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Load incident recorder</h2>
            <span className="text-xs text-muted-foreground">
              {!status
                ? "Connecting…"
                : !status.supported
                  ? "Linux only"
                  : status.error || stale
                    ? "Collection delayed"
                    : latest
                      ? "Watching · 1 second sampling"
                      : "Starting…"}
            </span>
          </div>
          {status?.supported ? (
            <>
              <p className="text-xs text-muted-foreground">
                Saves up to five minutes before a trigger and two minutes after
                pressure subsides. Select an incident, or click a spike in
                System load.
              </p>
              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
                <Reading
                  label="Runnable tasks"
                  reading={stale ? "Delayed" : String(latest?.runnable ?? "—")}
                />
                <Reading
                  label="Blocked tasks"
                  reading={stale ? "Delayed" : String(latest?.blocked ?? "—")}
                />
                <Reading
                  label="CPU pressure"
                  reading={stale ? "Delayed" : pct(latest?.pressure.cpu?.some)}
                />
                <Reading
                  label="Memory pressure"
                  reading={
                    stale ? "Delayed" : pct(latest?.pressure.memory?.some)
                  }
                />
                <Reading
                  label="I/O pressure"
                  reading={stale ? "Delayed" : pct(latest?.pressure.io?.some)}
                />
              </div>
              {status.error && (
                <p role="alert" className="text-xs text-destructive">
                  {status.error}
                </p>
              )}
              {!!latest?.warnings.length && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    Current collection limits ({latest.warnings.length})
                  </summary>
                  <p className="mt-2 break-words">
                    {latest.warnings.join(" · ")}
                  </p>
                </details>
              )}
              {status.incidents.length ? (
                <div
                  className="flex max-h-48 flex-wrap gap-2 overflow-y-auto"
                  aria-label="Saved incidents"
                >
                  {status.incidents.map((incident) => (
                    <Button
                      key={incident.id}
                      variant={
                        selected === incident.id ? "secondary" : "outline"
                      }
                      size="sm"
                      className="h-auto max-w-full whitespace-normal py-2 text-left text-xs"
                      onClick={() => select(incident.id)}
                      aria-pressed={selected === incident.id}
                    >
                      {time(incident.triggeredAt)} · {incident.status} ·{" "}
                      {incident.samples} readings
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No incidents recorded yet. Collection continues with the
                  browser closed.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {status
                ? "Incident diagnostics require Linux /proc counters. Your regular system metrics continue on macOS."
                : "Waiting for the collector."}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {selected !== null && !detail && !error && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading incident…
            </p>
          )}
        </CardContent>
      </Card>
      {detail?.id === selected && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="space-y-1">
              <p>{detail.reasons.join(" · ")}</p>
              <p className="text-muted-foreground">
                Retained window: {time(detail.startedAt)} —{" "}
                {time(detail.endedAt)} · {detail.status}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onShowRange({
                    from: detail.startedAt,
                    to: Math.max(detail.endedAt, detail.startedAt + 1000),
                  })
                }
              >
                Show window in dashboard
              </Button>
              {window && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setWindow(undefined)}
                >
                  Reset incident zoom
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Drag to zoom the incident charts together. Click a point to inspect
            its disk activity and blocked threads. Missing readings are shown as
            gaps.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <MetricChart
              title="Tasks and load"
              description="Instantaneous queues alongside the one-minute load average"
              data={timeline}
              unit="load"
              variant="line"
              window={chartWindow}
              onZoom={setWindow}
              onInspect={inspect}
              series={[
                { key: "load", label: "Load 1m", color: "var(--chart-1)" },
                { key: "runnable", label: "Runnable", color: "var(--chart-2)" },
                { key: "blocked", label: "Blocked", color: "var(--chart-3)" },
              ]}
            />
            <MetricChart
              title="Resource pressure"
              description="Percentage of each interval with some tasks stalled"
              data={timeline}
              variant="line"
              window={chartWindow}
              onZoom={setWindow}
              onInspect={inspect}
              series={[
                { key: "cpu", label: "CPU", color: "var(--chart-1)" },
                { key: "memory", label: "Memory", color: "var(--chart-2)" },
                { key: "io", label: "I/O", color: "var(--chart-3)" },
              ]}
            />
            <MetricChart
              title="CPU activity and waits"
              description="I/O wait is supporting evidence; it does not identify the blocked workload"
              data={timeline}
              variant="line"
              window={chartWindow}
              onZoom={setWindow}
              onInspect={inspect}
              series={[
                { key: "busy", label: "Busy", color: "var(--chart-1)" },
                { key: "iowait", label: "I/O wait", color: "var(--chart-2)" },
                { key: "steal", label: "Steal", color: "var(--chart-3)" },
              ]}
            />
            <MetricChart
              title="Swap and major faults"
              description="Swap pages/s and major faults/s · allocated swap alone does not indicate thrashing"
              data={timeline}
              unit="load"
              variant="line"
              window={chartWindow}
              onZoom={setWindow}
              onInspect={inspect}
              series={[
                { key: "swapIn", label: "Swap in", color: "var(--chart-1)" },
                { key: "swapOut", label: "Swap out", color: "var(--chart-2)" },
                {
                  key: "majorFaults",
                  label: "Major faults",
                  color: "var(--chart-3)",
                },
              ]}
            />
          </div>
          <Card className="min-w-0 shadow-none">
            <CardContent className="space-y-4 px-5 sm:px-6">
              <h3 className="text-sm font-semibold">
                Repeatedly blocked threads
              </h3>
              <p className="text-xs text-muted-foreground">
                Ranked by D-state observations in this window, independently of
                CPU and memory use. These are affected tasks; a wait location
                alone does not prove the cause.
              </p>
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="p-2">Thread · PID / TID</th>
                      <th className="p-2">Observations</th>
                      <th className="p-2">Kernel wait locations</th>
                      <th className="p-2">Service / cgroup</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.slice(0, 100).map((t) => (
                      <tr key={t.id} className="border-b last:border-0">
                        <td className="p-2">
                          {t.name}
                          <span className="block font-mono text-muted-foreground">
                            {t.pid} / {t.tid}
                          </span>
                        </td>
                        <td className="p-2 tabular-nums">
                          {t.observations} / {visible.length}
                        </td>
                        <td className="max-w-72 break-words p-2 font-mono">
                          {[...t.waits].join(", ")}
                        </td>
                        <td className="max-w-64 break-all p-2 font-mono">
                          {t.cgroup ?? "Unavailable"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!ranked.length && (
                  <p className="py-4 text-muted-foreground">
                    No blocked threads captured in this window. Check collection
                    limits below.
                  </p>
                )}
              </div>
              {ranked.length > 100 && (
                <p className="text-xs text-muted-foreground">
                  Showing the first 100 of {ranked.length} observed threads.
                  Individual sample inspection retains the captured details.
                </p>
              )}
              {!!warnings.length && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    Collection limits in this window ({warnings.length})
                  </summary>
                  <p className="mt-2 break-words">{warnings.join(" · ")}</p>
                </details>
              )}
            </CardContent>
          </Card>
          {current && (
            <Card className="min-w-0 shadow-none">
              <CardContent className="space-y-4 px-5 sm:px-6">
                <h3 className="text-sm font-semibold">
                  Sample inspection · {time(current.timestamp)}
                </h3>
                <label className="flex flex-wrap items-center gap-2 text-xs">
                  Sample
                  <select
                    aria-label="Inspect incident sample"
                    className="max-w-full rounded-md border bg-background p-2 font-mono"
                    value={current.timestamp}
                    onChange={(e) => setPoint(Number(e.target.value))}
                  >
                    {visible.map((r) => (
                      <option key={r.timestamp} value={r.timestamp}>
                        {new Date(r.timestamp).toLocaleTimeString()} ·{" "}
                        {r.blocked ?? "?"} blocked
                      </option>
                    ))}
                  </select>
                  <span className="text-muted-foreground">
                    Collection took {current.durationMs} ms
                  </span>
                </label>
                <p className="text-xs text-muted-foreground">
                  Disk latency is the average for completed reads/writes in this
                  interval. Devices and partitions may overlap; values are never
                  summed.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full whitespace-nowrap text-left text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="p-2">Device</th>
                        <th className="p-2">Read / write</th>
                        <th className="p-2">Latency</th>
                        <th className="p-2">Average queue</th>
                        <th className="p-2">In flight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.disks.map((d) => (
                        <tr key={d.device} className="border-b last:border-0">
                          <td className="p-2 font-mono">{d.device}</td>
                          <td className="p-2">
                            {rate(d.readBytes)} / {rate(d.writeBytes)}
                          </td>
                          <td className="p-2">{value(d.latencyMs, " ms")}</td>
                          <td className="p-2">{value(d.queue)}</td>
                          <td className="p-2">{d.inFlight}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-2 text-xs">
                  <p className="font-medium">
                    Blocked threads in this sample ({current.threads.length})
                  </p>
                  {current.threads.map((t) => (
                    <p
                      key={t.id}
                      className="break-words font-mono text-muted-foreground"
                    >
                      {t.name} · {t.pid}/{t.tid} ·{" "}
                      {t.wait ?? "Wait unavailable"}
                    </p>
                  ))}
                  {!current.threads.length && (
                    <p className="text-muted-foreground">None captured.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </section>
  );
}
function Reading({ label, reading }: { label: string; reading: string }) {
  return (
    <div className="space-y-1 rounded-md bg-muted/40 p-3">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-mono text-sm tabular-nums">{reading}</p>
    </div>
  );
}
