import { getAuth } from "./auth.server";

export const performanceEnabled = () => process.env.SENTINEL_DEBUG_PERF === "1";
const round = (value: number) => Math.round(value * 100) / 100;

export function logPerformance(event: string, fields: Record<string, unknown>) {
  if (performanceEnabled())
    console.info(
      `[sentinel:perf] ${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}`,
    );
}

export class PerformanceTrace {
  readonly id = crypto.randomUUID();
  private started = performance.now();
  private cpu = process.cpuUsage();
  readonly timings: Record<string, number> = {};
  readonly counts: Record<string, number> = {};

  measure<T>(name: string, action: () => T): T {
    const started = performance.now();
    try {
      return action();
    } finally {
      this.timings[name] = round(performance.now() - started);
    }
  }

  finish(fields: Record<string, unknown>) {
    const cpu = process.cpuUsage(this.cpu);
    logPerformance("metrics", {
      requestId: this.id,
      durationMs: round(performance.now() - this.started),
      timingsMs: this.timings,
      counts: this.counts,
      cpuMs: round((cpu.user + cpu.system) / 1000),
      rssBytes: process.memoryUsage().rss,
      ...fields,
    });
  }
}

// Browser measurements contain only a server-issued ID and bounded numbers.
// No URLs, credentials, process names, or arbitrary client text enter the log.
export async function receiveBrowserPerformance(request: Request) {
  if (!performanceEnabled()) return new Response(null, { status: 404 });
  if (!getAuth().sameOrigin(request))
    return new Response(null, { status: 403 });
  if (request.headers.get("content-type") !== "application/json")
    return new Response(null, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2048) {
      await reader.cancel();
      return new Response(null, { status: 413 });
    }
    chunks.push(value);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return new Response(null, { status: 400 });
  }
  if (
    !input ||
    typeof input !== "object" ||
    typeof input.requestId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(input.requestId)
  )
    return new Response(null, { status: 400 });
  const fields: Record<string, number | string> = {
    requestId: input.requestId,
  };
  for (const key of [
    "headersMs",
    "bodyMs",
    "parseMs",
    "commitMs",
    "twoFramesMs",
    "totalMs",
  ]) {
    const value = input[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 86_400_000
    )
      return new Response(null, { status: 400 });
    fields[key] = round(value);
  }
  logPerformance("browser", fields);
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
