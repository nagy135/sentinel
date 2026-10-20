import si from "systeminformation";
import { loadavg, platform, uptime } from "node:os";
import { readConfig } from "./config.server";
import { MetricsStore } from "./store.server";
import { hostDisks, readHostIdentity } from "./host.server";
import { ProcessCollector } from "./processes.server";
import type {
  DashboardData,
  HostInfo,
  NetworkMetric,
  TimeRange,
  Sample,
} from "../lib/metrics";
import { ranges } from "../lib/metrics";

const valid = (value: number): number | null =>
  Number.isFinite(value) && value >= 0 ? value : null;
const percent = (value: number) =>
  valid(value) === null ? null : Math.min(100, value);
const sum = (values: (number | null)[]) =>
  values.length && values.every((v) => v !== null)
    ? values.reduce<number>((a, v) => a + v!, 0)
    : null;

export class Collector {
  readonly config = readConfig();
  readonly store = new MetricsStore(this.config.dbPath);
  host: HostInfo | null = null;
  running = false;
  error: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastNetworks = new Map<
    string,
    { received: number; sent: number; timestamp: number }
  >();
  private pending: Promise<void> | null = null;
  private stopped = false;
  private processes = new ProcessCollector();

  async start() {
    if (this.running) return;
    const os = platform();
    if (os !== "linux" && os !== "darwin")
      throw new Error(
        `Unsupported platform: ${os}. Sentinel supports Linux and macOS.`,
      );
    if (this.config.hostRoot && os !== "linux")
      throw new Error("SENTINEL_HOST_ROOT is supported only on Linux.");
    this.running = true;
    const [system, info, cpu] = await Promise.all([
      si.system(),
      si.osInfo(),
      si.cpu(),
    ]);
    const identity = this.config.hostRoot
      ? await readHostIdentity(this.config.hostRoot)
      : null;
    this.host = {
      hostname: info.hostname,
      platform: os,
      os: identity?.os ?? info.distro,
      release: identity?.release ?? info.release,
      kernel: info.kernel,
      arch: info.arch,
      cpu: `${cpu.manufacturer} ${cpu.brand}`.trim(),
      cores: cpu.cores,
      physicalCores: cpu.physicalCores,
      model: [system.manufacturer, system.model].filter(Boolean).join(" "),
    };
    // Prime CPU deltas. The first network sample deliberately reports no rate.
    await si.currentLoad();
    await this.tick();
  }

  private async capture(): Promise<Sample> {
    const warnings: string[] = [];
    async function read<T>(
      label: string,
      fn: () => Promise<T>,
    ): Promise<T | null> {
      try {
        return await fn();
      } catch (error) {
        console.error(`[sentinel] ${label} collection failed`, error);
        warnings.push(`${label} unavailable`);
        return null;
      }
    }
    const [cpu, mem, filesystems, interfaces, traffic, temperature, processes] =
      await Promise.all([
        read("CPU", () => si.currentLoad()),
        read("Memory", () => si.mem()),
        read("Disks", () => si.fsSize()),
        read("Network interfaces", () => si.networkInterfaces()),
        read("Network traffic", () => si.networkStats("*")),
        read("Temperature", () => si.cpuTemperature()),
        read("Processes", () => this.processes.capture()),
      ]);
    const [one, five, fifteen] = loadavg();
    const timestamp = Date.now();
    let disks = (filesystems ?? [])
      .filter(
        (disk) =>
          disk.size > 0 &&
          !["tmpfs", "devtmpfs", "squashfs", "overlay"].includes(disk.type),
      )
      .map((disk) => ({
        filesystem: disk.fs,
        mount: disk.mount,
        type: disk.type,
        total: disk.size,
        used: disk.used,
        available: disk.available,
        percent: Math.min(100, Math.max(0, disk.use)),
      }));
    if (this.config.hostRoot) {
      disks =
        (await read("Host volumes", () =>
          hostDisks(disks, this.config.hostRoot!),
        )) ?? [];
    }
    // APFS System and Data volumes share a container; never sum their capacities.
    const mainDisk =
      disks.find((d) => d.mount === "/System/Volumes/Data") ??
      disks.find((d) => d.mount === "/") ??
      disks[0];
    const external = new Set(
      (Array.isArray(interfaces) ? interfaces : [])
        .filter((i) => !i.internal)
        .map((i) => i.iface),
    );
    const networks: NetworkMetric[] = (traffic ?? [])
      .filter((n) => external.has(n.iface) && n.operstate === "up")
      .map((n) => {
        const received = valid(n.rx_bytes);
        const sent = valid(n.tx_bytes);
        const previous = this.lastNetworks.get(n.iface);
        const seconds = previous ? (timestamp - previous.timestamp) / 1000 : 0;
        const rx =
          previous &&
          seconds > 0 &&
          received !== null &&
          received >= previous.received
            ? (received - previous.received) / seconds
            : null;
        const tx =
          previous && seconds > 0 && sent !== null && sent >= previous.sent
            ? (sent - previous.sent) / seconds
            : null;
        if (received !== null && sent !== null)
          this.lastNetworks.set(n.iface, { received, sent, timestamp });
        return {
          iface: n.iface,
          received: received ?? 0,
          sent: sent ?? 0,
          rx,
          tx,
        };
      });
    for (const name of this.lastNetworks.keys())
      if (!networks.some((n) => n.iface === name))
        this.lastNetworks.delete(name);
    return {
      timestamp,
      uptime: uptime(),
      cpu: cpu ? percent(cpu.currentLoad) : null,
      load: [one, five, fifteen].every((value) => valid(value) !== null)
        ? { one, five, fifteen }
        : null,
      temperature: temperature?.main != null ? valid(temperature.main) : null,
      cores: cpu?.cpus.map((c) => percent(c.load)) ?? [],
      memory:
        mem && mem.total > 0
          ? {
              total: mem.total,
              used: mem.active,
              percent: Math.min(100, (mem.active / mem.total) * 100),
              swapUsed: mem.swapused,
              swapTotal: mem.swaptotal,
            }
          : null,
      disk: mainDisk?.percent ?? null,
      disks,
      networks,
      rx: sum(networks.map((n) => n.rx)),
      tx: sum(networks.map((n) => n.tx)),
      warnings,
      processes,
    };
  }

  private async tick() {
    if (this.stopped) return;
    const started = Date.now();
    this.pending = (async () => {
      try {
        const sample = await this.capture();
        this.store.insert(sample);
        this.error = null;
      } catch (error) {
        this.error =
          error instanceof Error ? error.message : "Collection failed";
        console.error("[sentinel] Could not save metrics:", error);
      }
    })();
    await this.pending;
    this.pending = null;
    if (!this.stopped)
      this.timer = setTimeout(
        () => void this.tick(),
        Math.max(0, this.config.intervalMs - (Date.now() - started)),
      );
  }

  dashboard(range: TimeRange): DashboardData {
    const now = Date.now();
    const storage = this.store.summary();
    const window =
      typeof range === "string"
        ? {
            from:
              range === "all" ? (storage.first ?? now) : now - ranges[range].ms,
            to: now,
          }
        : range;
    return {
      host: this.host,
      latest: this.store.latest(),
      history: this.store.history(window, now),
      processes: {
        cpu: this.store.processHistory(window, "cpu", this.config.intervalMs),
        memory: this.store.processHistory(
          window,
          "memory",
          this.config.intervalMs,
        ),
      },
      storage,
      collector: {
        running: this.running && !this.stopped,
        intervalMs: this.config.intervalMs,
        error: this.error,
      },
      range,
      window,
      now,
    };
  }

  async stop() {
    this.stopped = true;
    this.running = false;
    clearTimeout(this.timer);
    await this.pending;
    this.store.close();
  }
}

const state = globalThis as typeof globalThis & {
  __sentinelCollector?: Collector;
};
export function getCollector() {
  return (state.__sentinelCollector ??= new Collector());
}
