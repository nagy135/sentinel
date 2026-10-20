import si from "systeminformation";
import { cpus, platform } from "node:os";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProcessMetric } from "../lib/metrics";

const run = promisify(execFile);
export const processLimit = 20;
const percentage = (value: number) =>
  Number.isFinite(value) && value >= 0 ? Math.min(100, value) : null;

export function selectProcesses(processes: ProcessMetric[]): ProcessMetric[] {
  const selected = new Map<string, ProcessMetric>();
  for (const metric of ["cpu", "memory"] as const) {
    const top = processes
      .filter((p) => p[metric] !== null)
      .sort((a, b) => b[metric]! - a[metric]! || a.pid - b.pid)
      .slice(0, processLimit);
    for (const process of top) selected.set(process.id, process);
  }
  return [...selected.values()];
}

export function linuxProcessIdentity(
  stat: string,
  bootId: string,
  pid: number,
) {
  // comm can contain spaces and parentheses. Field 22 is the boot-relative start tick.
  const end = stat.lastIndexOf(")");
  const start = stat
    .slice(end + 1)
    .trim()
    .split(/\s+/)[19];
  if (
    end < 0 ||
    !/^\d+$/.test(start ?? "") ||
    Number(stat.split(" ")[0]) !== pid
  )
    throw new Error("Invalid process start time");
  return `${bootId}:${pid}:${start}`;
}

export class ProcessCollector {
  private previous = new Set<number>();
  private identities = new Map<number, string>();
  private bootId: string | null = null;

  async capture(): Promise<ProcessMetric[]> {
    const result = await si.processes();
    if (!result.list.length) throw new Error("Process list unavailable");
    const os = platform();
    const cores = Math.max(1, cpus().length);
    const candidates = selectProcesses(
      result.list
        .filter((p) => Number.isSafeInteger(p.pid) && p.pid > 0)
        .map((p) => ({
          id: String(p.pid),
          pid: p.pid,
          // Persist only an executable name, never command arguments or environment.
          name: p.name.trim().split(/\s+/)[0]?.slice(0, 128) || "unknown",
          // Linux systeminformation normalizes against all cores; macOS ps uses one core.
          // The first observation has no interval baseline and must not pretend to be current CPU.
          cpu: this.previous.has(p.pid)
            ? percentage(p.cpu / (os === "darwin" ? cores : 1))
            : null,
          memory: percentage(p.mem),
        })),
    );
    this.previous = new Set(result.list.map((p) => p.pid));

    const ids = new Map<number, string>();
    if (os === "linux") {
      this.bootId ??= (
        await readFile("/proc/sys/kernel/random/boot_id", "utf8")
      ).trim();
      await Promise.all(
        candidates.map(async (p) => {
          try {
            ids.set(
              p.pid,
              linuxProcessIdentity(
                await readFile(`/proc/${p.pid}/stat`, "utf8"),
                this.bootId!,
                p.pid,
              ),
            );
          } catch {
            /* A process can exit between the listing and start-time read. */
          }
        }),
      );
    } else if (candidates.length) {
      // lstart is stable to the second; systeminformation's elapsed-time-derived start
      // can jitter between samples. No command strings or arguments are requested here.
      let output = "";
      try {
        output = (
          await run(
            "ps",
            [
              "-p",
              candidates.map((p) => p.pid).join(","),
              "-o",
              "pid=,lstart=",
            ],
            {
              env: { ...process.env, LC_ALL: "C" },
              timeout: 5000,
            },
          )
        ).stdout;
      } catch (error) {
        output = (error as { stdout?: string }).stdout ?? "";
      }
      for (const line of output.split("\n")) {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        if (match && Number.isFinite(Date.parse(match[2])))
          ids.set(
            Number(match[1]),
            `darwin:${match[1]}:${match[2].replace(/\s+/g, " ")}`,
          );
      }
    }
    const saved = candidates.flatMap((p) => {
      const id = ids.get(p.pid);
      if (!id) return [];
      const previousId = this.identities.get(p.pid);
      return [
        { ...p, id, cpu: previousId && previousId !== id ? null : p.cpu },
      ];
    });
    this.identities = ids;
    if (candidates.length && !saved.length)
      throw new Error("Process start times unavailable");
    return saved;
  }
}
