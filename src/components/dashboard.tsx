import { LoadChart } from "@/components/load-chart";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  CircleAlert,
  Clock3,
  Cpu,
  Database,
  HardDrive,
  MemoryStick,
  LogOut,
  Monitor,
  Network,
  Radio,
  Server,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { TimeRangePicker } from "@/components/time-range-picker";
import { RefreshPicker, useRefreshInterval } from "@/components/refresh-picker";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { DashboardGrid } from "@/components/dashboard-grid";
import type { BlockId } from "@/lib/dashboard-layout";
import { MetricChart } from "@/components/metric-chart";
import { ProcessChart } from "@/components/process-chart";
import { bytes, duration, pct, rate } from "@/lib/format";
import { type DashboardData, type TimeRange } from "@/lib/metrics";
import { formatRangeDuration, timeRangeQuery } from "@/lib/time-range";

const primaryChart = "var(--chart-1)";
const secondaryChart = "var(--chart-2)";

function useMetrics(range: TimeRange, refreshSeconds: number | null) {
  const query = timeRangeQuery(range);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pollSeconds, setPollSeconds] = useState(refreshSeconds ?? 5);
  const [receivedAt, setReceivedAt] = useState(0);
  const pendingTiming = useRef<{
    data: DashboardData;
    started: number;
    parsedAt: number;
    fields: {
      requestId: string;
      headersMs: number;
      bodyMs: number;
      parseMs: number;
    };
  } | null>(null);
  useEffect(() => {
    const timing = pendingTiming.current;
    if (!timing || timing.data !== data) return;
    pendingTiming.current = null;
    if (document.hidden) return;
    // Effects run after the DOM commit. Two frames approximate the wait until
    // the updated charts can be painted; this isn't an exact paint timestamp.
    const committedAt = performance.now();
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (document.hidden) return;
        const finished = performance.now();
        void fetch("/api/metrics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...timing.fields,
            commitMs: committedAt - timing.parsedAt,
            twoFramesMs: finished - committedAt,
            totalMs: finished - timing.started,
          }),
          keepalive: true,
        }).catch(() => {
          /* Diagnostics must not affect dashboard polling. */
        });
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [data]);
  useEffect(() => {
    if (refreshSeconds === null) return;
    let stopped = false;
    let inFlight = false;
    let abort: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      const seconds = document.hidden
        ? Math.max(refreshSeconds, 60)
        : refreshSeconds;
      setPollSeconds(seconds);
      setNextRefreshAt(Date.now() + seconds * 1000);
      timer = setTimeout(() => void poll(), seconds * 1000);
    };
    const poll = async () => {
      clearTimeout(timer);
      abort?.abort();
      const request = new AbortController();
      abort = request;
      inFlight = true;
      setPollSeconds(
        document.hidden ? Math.max(refreshSeconds, 60) : refreshSeconds,
      );
      setNextRefreshAt(null);
      setIsRefreshing(true);
      try {
        const started = performance.now();
        const response = await fetch(`/api/metrics?${query}`, {
          signal: request.signal,
          cache: "no-store",
        });
        if (response.status === 401) {
          if (request.signal.aborted) return;
          inFlight = false;
          setIsRefreshing(false);
          window.location.replace("/login");
          return;
        }
        if (!response.ok)
          throw new Error("Could not reach the metrics service.");
        const headersAt = performance.now();
        const requestId = response.headers.get("X-Sentinel-Perf");
        let next: DashboardData;
        if (requestId) {
          const body = await response.text();
          const bodyAt = performance.now();
          next = JSON.parse(body);
          const parsedAt = performance.now();
          if (request.signal.aborted) return;
          pendingTiming.current = {
            data: next,
            started,
            parsedAt,
            fields: {
              requestId,
              headersMs: headersAt - started,
              bodyMs: bodyAt - headersAt,
              parseMs: parsedAt - bodyAt,
            },
          };
        } else {
          next = await response.json();
        }
        if (request.signal.aborted) return;
        setData(next);
        setReceivedAt(Date.now());
        setError(null);
      } catch (error) {
        if (!request.signal.aborted)
          setError(error instanceof Error ? error.message : "Connection lost.");
      }
      if (!stopped && !request.signal.aborted) {
        inFlight = false;
        setIsRefreshing(false);
        schedule();
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        // Let an active request finish, then use the background interval.
        setPollSeconds(Math.max(refreshSeconds, 60));
        if (!inFlight) schedule();
      } else {
        // Replace any background request so returning always fetches fresh data.
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void poll();
    return () => {
      stopped = true;
      abort?.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [query, refreshSeconds]);
  return { data, error, nextRefreshAt, receivedAt, isRefreshing, pollSeconds };
}

function Stat({
  icon,
  label,
  value,
  detail,
  status,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: ReactNode;
  status: "Live" | "Delayed" | "Reconnecting" | "Connecting";
  children?: ReactNode;
}) {
  return (
    <Card
      data-live-card={label}
      className={`relative gap-0 py-5 shadow-none ${status === "Live" ? "border-success/40" : "border-muted-foreground/35"}`}
    >
      <span
        className={`absolute -top-2.5 left-4 inline-flex items-center gap-1.5 bg-card px-2 text-[10px] font-semibold tracking-wide uppercase ${status === "Live" ? "text-success" : "text-muted-foreground"}`}
      >
        <span
          className={`size-1.5 rounded-full ${status === "Live" ? "bg-success" : "bg-muted-foreground"}`}
        />
        {status}
      </span>
      <CardContent className="space-y-4 px-5">
        <div className="flex items-center justify-between text-muted-foreground">
          <h2 className="text-xs font-medium">{label}</h2>
          {icon}
        </div>
        <div>
          <div className="font-mono text-[28px] font-medium leading-tight tracking-tight tabular-nums">
            {value}
          </div>
          <div className="mt-1.5 truncate text-xs text-muted-foreground">
            {detail}
          </div>
        </div>
        {children}
        <p className="border-t border-current/10 pt-3 text-[10px] leading-relaxed text-muted-foreground">
          {status === "Live"
            ? "Always current, even when zoomed"
            : status === "Connecting"
              ? "Waiting for the first sample"
              : "Last saved reading · updates delayed"}
        </p>
      </CardContent>
    </Card>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-5 border-b py-3 text-xs last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words">
        {children || "—"}
      </dd>
    </div>
  );
}

export function Dashboard() {
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    setSigningOut(true);
    setLogoutError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Could not sign out. Try again.");
      window.location.replace("/login");
    } catch {
      setLogoutError("Could not sign out. Try again.");
      setSigningOut(false);
    }
  }
  const [range, setRange] = useState<TimeRange>("1h");
  const [zoomHistory, setZoomHistory] = useState<TimeRange[]>([]);
  function changeRange(next: TimeRange) {
    setZoomHistory((previous) =>
      typeof next === "string" ? [] : [...previous, range],
    );
    setRange(next);
  }
  function undoZoom() {
    const previous = zoomHistory.at(-1);
    if (!previous) return;
    setZoomHistory(zoomHistory.slice(0, -1));
    setRange(previous);
  }
  function resetZoom() {
    setRange(zoomHistory.find((value) => typeof value === "string") ?? "1h");
    setZoomHistory([]);
  }
  const { refreshSeconds, changeRefresh, refreshSaveError } =
    useRefreshInterval();
  const { data, error, nextRefreshAt, receivedAt, isRefreshing, pollSeconds } =
    useMetrics(range, refreshSeconds);
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const sample = data?.latest;
  const host = data?.host;
  const age = sample
    ? Math.max(0, Math.floor((now - sample.timestamp) / 1000))
    : null;
  const staleAfter = Math.max((data?.collector.intervalMs ?? 5000) * 3, 15_000);
  // A slow refresh preference is expected; an already-old server sample is not.
  const stale =
    !!sample &&
    (receivedAt - sample.timestamp > staleAfter ||
      now - sample.timestamp > staleAfter + pollSeconds * 1000);
  const live =
    !!sample &&
    data?.collector.running &&
    !error &&
    !data.collector.error &&
    !stale;
  const liveStatus = live
    ? "Live"
    : error
      ? "Reconnecting"
      : sample
        ? "Delayed"
        : "Connecting";
  const loading = !data || timeRangeQuery(data.range) !== timeRangeQuery(range);
  const history = data?.history ?? [];
  const mainDisk =
    sample?.disks.find((d) => d.mount === "/System/Volumes/Data") ??
    sample?.disks.find((d) => d.mount === "/") ??
    sample?.disks[0];
  const warnings = [
    refreshSaveError
      ? "Refresh preference could not be saved in this browser."
      : null,
    logoutError,
    error,
    data?.collector.error,
    ...(sample?.warnings ?? []),
    stale && !error
      ? "Metrics are delayed. The last saved values are shown."
      : null,
  ].filter(Boolean);
  const blocks: Record<BlockId, ReactNode> = {
    system: (
      <section
        aria-label="Detected system"
        className="flex flex-wrap items-center gap-x-7 gap-y-4 rounded-xl border bg-card px-5 py-5 sm:px-6"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-muted/70">
          <Monitor className="size-5 text-muted-foreground" />
        </span>
        <div className="min-w-[140px] flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="break-all text-sm font-semibold">
              {host?.hostname ?? "Detecting your machine…"}
            </h2>
            {host && (
              <Badge
                variant="secondary"
                className="rounded-md text-[10px] font-medium"
              >
                {host.platform === "darwin" ? "macOS" : "Linux"}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {host
              ? `${host.os} ${host.release} · ${host.arch}`
              : "Reading system information"}
          </p>
        </div>
        <div className="hidden h-8 w-px bg-border md:block" />
        <div className="hidden min-w-0 max-w-64 space-y-1 md:block">
          <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
            Processor
          </p>
          <p className="truncate text-xs" title={host?.cpu}>
            {host?.cpu ?? "—"}
            <span className="text-muted-foreground">
              {" "}
              · {host?.cores ?? "—"} cores
            </span>
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
            Uptime
          </p>
          <p className="flex items-center gap-1.5 font-mono text-xs">
            <Clock3 className="size-3 text-muted-foreground" />
            {duration(sample?.uptime)}
          </p>
        </div>
        <Badge
          variant="outline"
          className="gap-1.5 border-primary/20 bg-accent px-2.5 py-1 text-[10px] font-medium text-primary"
        >
          <Radio className="size-3" />
          {host ? "Auto-detected" : "Detecting"}
        </Badge>
      </section>
    ),
    cpu: (
      <Stat
        icon={<Cpu className="size-4" />}
        label="CPU usage"
        status={liveStatus}
        value={pct(sample?.cpu)}
        detail={`${host?.cores ?? "—"} logical cores · ${host?.physicalCores ?? "—"} physical`}
      >
        <Progress
          aria-label="CPU usage"
          value={sample?.cpu ?? 0}
          className="h-1"
        />
      </Stat>
    ),
    memory: (
      <Stat
        icon={<MemoryStick className="size-4" />}
        label="Memory usage"
        status={liveStatus}
        value={pct(sample?.memory?.percent)}
        detail={`${bytes(sample?.memory?.used)} of ${bytes(sample?.memory?.total)} active`}
      >
        <Progress
          aria-label="Memory usage"
          value={sample?.memory?.percent ?? 0}
          className="h-1"
        />
      </Stat>
    ),
    storage: (
      <Stat
        icon={<HardDrive className="size-4" />}
        label="Storage used"
        status={liveStatus}
        value={pct(sample?.disk)}
        detail={
          mainDisk
            ? `${bytes(mainDisk.used)} used · ${bytes(mainDisk.available)} free`
            : "Waiting for disk information"
        }
      >
        <Progress
          aria-label="Storage used"
          value={sample?.disk ?? 0}
          className="h-1"
        />
      </Stat>
    ),
    network: (
      <Stat
        icon={<Network className="size-4" />}
        label="Network traffic"
        status={liveStatus}
        value={
          <span className="flex items-center gap-2 text-[24px]">
            <ArrowDown className="size-4 text-primary" />
            {rate(sample?.rx)}
          </span>
        }
        detail={
          <span className="flex items-center gap-1">
            <ArrowUp className="size-3" />
            {rate(sample?.tx)} sent
            <span className="ml-auto">
              {sample?.networks.length ?? 0} active
            </span>
          </span>
        }
      >
        <div className="h-1 rounded-full bg-muted" />
      </Stat>
    ),
    "cpu-history": (
      <MetricChart
        title="CPU utilization"
        description="Total activity across all processor cores"
        data={history}
        series={[{ key: "cpu", label: "CPU", color: primaryChart }]}
        loading={loading}
        window={data?.window}
        onZoom={changeRange}
      >
        <div className="mt-4 flex items-center gap-3 border-t px-2 pt-4">
          <span className="shrink-0 text-[10px] text-muted-foreground">
            Per core
          </span>
          <div className="flex min-w-0 flex-1 gap-1">
            {sample?.cores.map((value, index) => (
              <div
                key={index}
                className="relative h-5 min-w-0 flex-1 overflow-hidden rounded-sm bg-muted"
                title={`Core ${index + 1}: ${pct(value)}`}
              >
                <div
                  className="absolute inset-x-0 bottom-0 bg-primary/70"
                  style={{ height: `${value ?? 0}%` }}
                />
              </div>
            ))}
          </div>
        </div>
      </MetricChart>
    ),
    "memory-history": (
      <MetricChart
        title="Memory utilization"
        description="Active memory, excluding reclaimable buffers and cache"
        data={history}
        series={[{ key: "memory", label: "Memory", color: primaryChart }]}
        loading={loading}
        window={data?.window}
        onZoom={changeRange}
      >
        <div className="mt-4 flex justify-between border-t px-2 pt-4 text-[10px] text-muted-foreground">
          <span>
            Physical memory{" "}
            <span className="ml-1.5 text-foreground">
              {bytes(sample?.memory?.total)}
            </span>
          </span>
          <span>
            Swap used{" "}
            <span className="ml-1.5 text-foreground">
              {bytes(sample?.memory?.swapUsed)}
            </span>
          </span>
        </div>
      </MetricChart>
    ),
    "process-cpu-history": (
      <ProcessChart
        metric="cpu"
        history={data?.processes.cpu}
        window={data?.window}
        loading={loading}
        onZoom={changeRange}
      />
    ),
    "process-memory-history": (
      <ProcessChart
        metric="memory"
        history={data?.processes.memory}
        window={data?.window}
        loading={loading}
        onZoom={changeRange}
      />
    ),
    "network-history": (
      <MetricChart
        title="Network throughput"
        description="Traffic across active, non-loopback interfaces"
        data={history}
        unit="bytes"
        series={[
          { key: "rx", label: "Received", color: primaryChart },
          { key: "tx", label: "Sent", color: secondaryChart },
        ]}
        loading={loading}
        window={data?.window}
        onZoom={changeRange}
      />
    ),
    "storage-history": (
      <MetricChart
        title="Storage utilization"
        description={
          mainDisk
            ? `Primary volume · ${mainDisk.mount}`
            : "Primary volume capacity used"
        }
        data={history}
        series={[{ key: "disk", label: "Storage", color: primaryChart }]}
        loading={loading}
        window={data?.window}
        onZoom={changeRange}
      />
    ),
    volumes: (
      <Card className="gap-4 shadow-none">
        <CardContent className="px-5 sm:px-6">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <HardDrive className="size-3.5 text-muted-foreground" />
            Mounted volumes
          </h2>
          <p className="mb-5 text-xs text-muted-foreground">
            Capacity by filesystem · shared volumes are listed separately
          </p>
          <div className="max-h-[340px] space-y-4 overflow-y-auto pr-2">
            {sample?.disks.length ? (
              sample.disks.map((disk) => (
                <div key={`${disk.filesystem}:${disk.mount}`}>
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                    <span
                      className="min-w-0 truncate font-mono"
                      title={`${disk.mount} (${disk.filesystem})`}
                    >
                      {disk.mount}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums">
                      {pct(disk.percent)}
                    </span>
                  </div>
                  <Progress
                    aria-label={`${disk.mount} usage`}
                    value={disk.percent}
                    className="h-1"
                  />
                  <div className="mt-1.5 flex justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>{disk.type}</span>
                    <span>
                      {bytes(disk.used)} used · {bytes(disk.available)} free
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-5 text-xs text-muted-foreground">
                No volume information available yet.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    ),
    interfaces: (
      <Card className="gap-4 shadow-none">
        <CardContent className="px-5 sm:px-6">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Network className="size-3.5 text-muted-foreground" />
            Network interfaces
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Active connections · bytes per second
          </p>
          <div>
            {sample?.networks.length ? (
              sample.networks.map((network) => (
                <div
                  key={network.iface}
                  className="flex items-center justify-between gap-2 border-b py-3 last:border-0"
                >
                  <span className="flex min-w-0 items-center gap-2 font-mono text-xs">
                    <span className="size-1.5 shrink-0 rounded-full bg-success" />
                    <span className="truncate">{network.iface}</span>
                  </span>
                  <div className="space-y-1 text-right font-mono text-[10px] tabular-nums">
                    <p className="flex items-center justify-end gap-1.5">
                      <ArrowDown className="size-3 text-primary" />
                      {rate(network.rx)}
                    </p>
                    <p className="flex items-center justify-end gap-1.5 text-muted-foreground">
                      <ArrowUpRight className="size-3" />
                      {rate(network.tx)}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-5 text-xs text-muted-foreground">
                No active interfaces detected yet.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    ),
    information: (
      <Card className="gap-4 shadow-none">
        <CardContent className="px-5 sm:px-6">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Server className="size-3.5 text-muted-foreground" />
            System information
          </h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Automatically detected on this host
          </p>
          <dl>
            <Info label="System">{host?.model}</Info>
            <Info label="Operating system">
              {host ? `${host.os} ${host.release}` : null}
            </Info>
            <Info label="Kernel">{host?.kernel}</Info>
            <Info label="Architecture">{host?.arch}</Info>
            <Info label="Processor">{host?.cpu}</Info>
            <Info label="Logical / physical cores">
              {host ? `${host.cores} / ${host.physicalCores}` : null}
            </Info>
          </dl>
        </CardContent>
      </Card>
    ),
    "load-history": (
      <LoadChart
        history={history}
        loading={loading}
        window={data?.window}
        onZoom={changeRange}
        incidents={data?.diagnostics?.incidents ?? []}
        cores={host?.cores}
        now={data?.now ?? 0}
      />
    ),
    "temperature-history": (
      <MetricChart
        title="CPU temperature"
        description="CPU sensor reading · degrees Celsius"
        data={history}
        unit="temperature"
        series={[{ key: "temperature", label: "CPU", color: primaryChart }]}
        loading={loading}
        window={data?.window}
        onZoom={changeRange}
        emptyMessage={
          sample && sample.temperature == null
            ? "Temperature sensor unavailable on this host"
            : undefined
        }
      >
        <div className="mt-4 flex flex-wrap justify-between gap-2 border-t px-2 pt-4 text-[10px] text-muted-foreground">
          <span>
            Current{" "}
            <span className="ml-1 font-mono text-foreground">
              {sample?.temperature != null
                ? `${sample.temperature.toFixed(1)} °C`
                : "Unavailable"}
            </span>
          </span>
          <span>
            {sample?.temperature != null
              ? "Reported by the host CPU sensor"
              : "No readable CPU sensor was detected"}
          </span>
        </div>
      </MetricChart>
    ),
  };
  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-card p-3 focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to dashboard
      </a>
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-5 py-4 sm:px-8 lg:px-12">
          <a
            href="/"
            className="flex items-center gap-2.5 font-semibold tracking-tight"
            aria-label="Sentinel home"
          >
            <span className="flex size-8 items-center justify-center rounded-[10px] bg-brand text-brand-foreground">
              <Activity className="size-4" strokeWidth={2.3} />
            </span>
            <span className="text-lg">
              sentinel<span className="text-brand">.</span>
            </span>
          </a>
          <div className="flex items-center gap-5">
            <span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <Terminal className="size-3.5" />
              {host?.hostname ?? "Local host"}
            </span>
            <ThemeSwitcher />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Sign out"
              title="Sign out"
              disabled={signingOut}
              onClick={() => void signOut()}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>
      <main
        id="main"
        className="mx-auto max-w-[1440px] space-y-6 px-5 py-7 sm:px-8 lg:px-12 lg:py-9"
      >
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Local machine</span>
              <span className="px-1 text-border">/</span>
              <span className="text-foreground">Overview</span>
            </div>
            <h1 className="text-[27px] font-semibold tracking-tight sm:text-3xl">
              System overview
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              A little clarity on everything your machine is doing.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={`size-1.5 rounded-full ${live ? "bg-success" : "bg-muted-foreground"}`}
                />
                {liveStatus}
              </span>
              <RefreshPicker
                seconds={refreshSeconds ?? 5}
                nextRefreshAt={nextRefreshAt}
                isRefreshing={isRefreshing}
                pollSeconds={pollSeconds}
                onChange={changeRefresh}
              />
            </div>
            <TimeRangePicker
              range={range}
              window={data?.window}
              onChange={changeRange}
              onBack={undoZoom}
              onReset={resetZoom}
              canGoBack={zoomHistory.length > 0}
            />
          </div>
        </div>

        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <p>
            Drag across any graph to zoom all graphs. Press Escape to cancel.
          </p>
          {typeof range !== "string" && (
            <p role="status" className="font-mono tabular-nums">
              {new Date(range.from).toLocaleString()} —{" "}
              {new Date(range.to).toLocaleString()} (local time) ·{" "}
              {formatRangeDuration(range)}
            </p>
          )}
        </div>

        {warnings.length > 0 && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>
              {warnings.join(" · ")}
              {error ? " Retrying automatically." : ""}
            </span>
          </div>
        )}

        <DashboardGrid blocks={blocks} />
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t pb-2 pt-5 text-[11px] text-muted-foreground">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5">
              <Database className="size-3" />
              Metric history saved locally
            </span>
            <span className="text-border">/</span>
            <span>{data?.storage.count.toLocaleString() ?? "0"} samples</span>
            <span className="text-border">/</span>
            <span>{bytes(data?.storage.bytes)}</span>
            {data?.storage.first && (
              <span className="hidden sm:inline">
                since {new Date(data.storage.first).toLocaleDateString()}
              </span>
            )}
          </p>
          <p>
            {data
              ? `Collecting every ${data.collector.intervalMs / 1000}s`
              : "Connecting to collector"}
            <span className="mx-2 text-border">/</span>
            {age !== null ? `Updated ${age}s ago` : "Waiting for first sample"}
          </p>
        </footer>
      </main>
    </div>
  );
}
