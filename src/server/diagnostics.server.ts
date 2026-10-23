import { readFile, readdir } from "node:fs/promises";
import { cpus, platform } from "node:os";
import type {
  DiagnosticSample,
  PressureMetric,
  BlockedThread,
  DiskActivity,
} from "../lib/diagnostics";

const numbers = (text: string) =>
  Object.fromEntries(
    text
      .trim()
      .split("\n")
      .map((line) => {
        const [name, value] = line.trim().split(/\s+/);
        return [name, Number(value)];
      }),
  );
export function parseTask(stat: string) {
  const end = stat.lastIndexOf(")");
  const fields = stat
    .slice(end + 1)
    .trim()
    .split(/\s+/);
  if (end < 0 || !/^\d+$/.test(fields[19] ?? ""))
    throw new Error("Invalid task stat");
  return {
    name: stat.slice(stat.indexOf("(") + 1, end).slice(0, 128),
    state: fields[0],
    start: fields[19],
  };
}
export function counterRate(
  current: number,
  previous: number | undefined,
  elapsedMs: number,
  scale = 1000,
): number | null {
  return previous !== undefined &&
    elapsedMs > 0 &&
    Number.isFinite(current) &&
    current >= previous
    ? ((current - previous) * scale) / elapsedMs
    : null;
}
export function parsePressure(text: string): { some?: number; full?: number } {
  const result: { some?: number; full?: number } = {};
  for (const line of text.trim().split("\n")) {
    const [kind] = line.split(" ");
    const total = line.match(/\btotal=(\d+)\b/);
    if ((kind === "some" || kind === "full") && total)
      result[kind] = Number(total[1]);
  }
  if (result.some === undefined) throw new Error("Invalid pressure counters");
  return result;
}
type DiskCounters = {
  device: string;
  reads: number;
  writes: number;
  sectorsRead: number;
  sectorsWritten: number;
  readMs: number;
  writeMs: number;
  weightedMs: number;
  inFlight: number;
};
export function parseDiskstats(text: string): DiskCounters[] {
  return text
    .trim()
    .split("\n")
    .flatMap((line) => {
      const f = line.trim().split(/\s+/);
      if (f.length < 14 || /^(loop|ram)\d+$/.test(f[2])) return [];
      const n = f.slice(3, 14).map(Number);
      if (!n.every((v) => Number.isFinite(v) && v >= 0)) return [];
      return [
        {
          device: f[2],
          reads: n[0],
          writes: n[4],
          sectorsRead: n[2],
          sectorsWritten: n[6],
          readMs: n[3],
          writeMs: n[7],
          inFlight: n[8],
          weightedMs: n[10],
        },
      ];
    });
}
// Only /proc counters are read here. No subprocesses, command arguments, or environment.
export class LinuxDiagnostics {
  private bootId: string | null = null;
  private previousAt: number | null = null;
  private previousCpu: number[] | undefined;
  private previousVm: Record<string, number> = {};
  private previousDisks = new Map<string, DiskCounters>();
  private previousPressure: Record<string, ReturnType<typeof parsePressure>> =
    {};
  constructor(private root = "/proc") {}

  async capture(timestamp = Date.now()): Promise<DiagnosticSample> {
    const started = performance.now();
    const warnings = new Set<string>();
    const read = async (path: string) => {
      try {
        return await readFile(`${this.root}/${path}`, "utf8");
      } catch {
        warnings.add(`${path} unavailable`);
        return null;
      }
    };
    const [stat, vmstat, diskstats, load, boot, ...pressures] =
      await Promise.all([
        read("stat"),
        read("vmstat"),
        read("diskstats"),
        read("loadavg"),
        this.bootId
          ? Promise.resolve(this.bootId)
          : read("sys/kernel/random/boot_id"),
        ...["cpu", "memory", "io"].map((resource) =>
          read(`pressure/${resource}`),
        ),
      ]);
    this.bootId = boot?.trim() || null;
    const elapsed = this.previousAt === null ? 0 : timestamp - this.previousAt;
    const pressure = {} as DiagnosticSample["pressure"];
    for (const [i, resource] of (["cpu", "memory", "io"] as const).entries()) {
      pressure[resource] = null;
      const previous = this.previousPressure[resource];
      delete this.previousPressure[resource];
      if (pressures[i] === null) continue;
      try {
        const current = parsePressure(pressures[i]!);
        const metric: PressureMetric = {
          some: counterRate(current.some!, previous?.some, elapsed, 0.1),
          full:
            resource === "cpu" || current.full === undefined
              ? null
              : counterRate(current.full, previous?.full, elapsed, 0.1),
        };
        pressure[resource] = metric;
        this.previousPressure[resource] = current;
      } catch {
        warnings.add(`pressure/${resource} invalid`);
      }
    }
    const counters = stat ? numbers(stat) : {};
    const cpu = stat
      ?.split("\n")[0]
      ?.trim()
      .split(/\s+/)
      .slice(1, 9)
      .map(Number);
    const delta =
      cpu && this.previousCpu && elapsed > 0
        ? cpu.map((v, i) => v - this.previousCpu![i])
        : null;
    const total = delta?.reduce((a, b) => a + b, 0) ?? 0;
    const cpuValid =
      delta &&
      delta.length === 8 &&
      delta.every((v) => Number.isFinite(v) && v >= 0) &&
      total > 0;
    const cpuMetric = cpuValid
      ? {
          busy: (100 * (total - delta[3] - delta[4] - delta[7])) / total,
          iowait: (100 * delta[4]) / total,
          steal: (100 * delta[7]) / total,
        }
      : { busy: null, iowait: null, steal: null };
    this.previousCpu = cpu;
    const vm = vmstat ? numbers(vmstat) : {};
    const swapIn = counterRate(vm.pswpin, this.previousVm.pswpin, elapsed);
    const swapOut = counterRate(vm.pswpout, this.previousVm.pswpout, elapsed);
    const majorFaults = counterRate(
      vm.pgmajfault,
      this.previousVm.pgmajfault,
      elapsed,
    );
    this.previousVm = vm;
    const currentDisks = diskstats ? parseDiskstats(diskstats) : [];
    if (currentDisks.length > 128)
      warnings.add("Disk details limited to 128 devices");
    const disks: DiskActivity[] = currentDisks.slice(0, 128).map((d) => {
      const p = this.previousDisks.get(d.device);
      const reset =
        !p ||
        [
          "reads",
          "writes",
          "sectorsRead",
          "sectorsWritten",
          "readMs",
          "writeMs",
          "weightedMs",
        ].some(
          (key) => d[key as keyof DiskCounters] < p[key as keyof DiskCounters],
        );
      const previous = reset ? undefined : p;
      const ops = previous
        ? d.reads + d.writes - previous.reads - previous.writes
        : 0;
      return {
        device: d.device,
        readBytes: counterRate(
          d.sectorsRead,
          previous?.sectorsRead,
          elapsed,
          512000,
        ),
        writeBytes: counterRate(
          d.sectorsWritten,
          previous?.sectorsWritten,
          elapsed,
          512000,
        ),
        latencyMs:
          previous && ops > 0 && elapsed > 0
            ? (d.readMs + d.writeMs - previous.readMs - previous.writeMs) / ops
            : null,
        queue: counterRate(d.weightedMs, previous?.weightedMs, elapsed, 1),
        inFlight: d.inFlight,
      };
    });
    this.previousDisks = new Map(currentDisks.map((d) => [d.device, d]));
    const threads: BlockedThread[] = [];
    let denied = 0;
    let truncated = 0;
    let reserved = 0;
    const gone = (e: unknown) =>
      ["ENOENT", "ESRCH"].includes((e as NodeJS.ErrnoException).code ?? "");
    let pids: string[] = [];
    try {
      pids = (await readdir(this.root)).filter((pid) => /^\d+$/.test(pid));
    } catch {
      warnings.add("Process enumeration unavailable");
    }
    // Limit concurrent filesystem requests; include every thread, not only leaders or top CPU users.
    for (let offset = 0; offset < pids.length; offset += 16) {
      await Promise.all(
        pids.slice(offset, offset + 16).map(async (pid) => {
          let tids: string[];
          try {
            tids = (await readdir(`${this.root}/${pid}/task`)).filter((tid) =>
              /^\d+$/.test(tid),
            );
          } catch (e) {
            if (!gone(e)) denied++;
            return;
          }
          let cgroup: string | null | undefined;
          for (const tid of tids) {
            try {
              const task = parseTask(
                await readFile(`${this.root}/${pid}/task/${tid}/stat`, "utf8"),
              );
              if (task.state !== "D") continue;
              if (reserved >= 200) {
                truncated++;
                continue;
              }
              if (!this.bootId) continue;
              reserved++;
              if (cgroup === undefined) {
                try {
                  cgroup =
                    (await readFile(`${this.root}/${pid}/cgroup`, "utf8"))
                      .trim()
                      .slice(0, 512) || null;
                } catch {
                  cgroup = null;
                  warnings.add("Some cgroup identities unavailable");
                }
              }
              let wait: string | null = null;
              try {
                const value = (
                  await readFile(
                    `${this.root}/${pid}/task/${tid}/wchan`,
                    "utf8",
                  )
                ).trim();
                wait = value && value !== "0" ? value.slice(0, 128) : null;
              } catch {
                /* Optional kernel symbols can be restricted. */
              }
              if (!wait) warnings.add("Some kernel wait locations unavailable");
              threads.push({
                id: `${this.bootId}:${pid}:${tid}:${task.start}`,
                pid: Number(pid),
                tid: Number(tid),
                name: task.name,
                cgroup,
                wait,
              });
            } catch (e) {
              if (!gone(e)) denied++;
            }
          }
        }),
      );
    }
    if (denied) warnings.add(`${denied} task reads unavailable`);
    if (truncated)
      warnings.add(`${truncated} blocked thread details omitted (limit 200)`);
    const parsedLoad = load === null ? NaN : Number(load.split(/\s+/)[0]);
    this.previousAt = timestamp;
    return {
      timestamp,
      durationMs: Math.round(performance.now() - started),
      load: Number.isFinite(parsedLoad) ? parsedLoad : null,
      runnable: Number.isFinite(counters.procs_running)
        ? counters.procs_running
        : null,
      blocked: Number.isFinite(counters.procs_blocked)
        ? counters.procs_blocked
        : null,
      cpu: cpuMetric,
      pressure,
      swapIn,
      swapOut,
      majorFaults,
      disks,
      threads,
      warnings: [...warnings],
    };
  }
}
export const diagnosticsSupported = () => platform() === "linux";
export const logicalCores = () => Math.max(1, cpus().length);
