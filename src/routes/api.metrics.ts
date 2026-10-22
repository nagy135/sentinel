import { createFileRoute } from "@tanstack/react-router";
import type { TimeRange } from "@/lib/metrics";
import { parseTimeRange } from "@/lib/time-range";

export const Route = createFileRoute("/api/metrics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let range: TimeRange;
        try {
          range = parseTimeRange(new URL(request.url).searchParams);
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error ? error.message : "Invalid time range.",
            },
            { status: 400 },
          );
        }
        const { getCollector } = await import("@/server/collector.server");
        const { PerformanceTrace, performanceEnabled, logPerformance } =
          await import("@/server/performance.server");
        const trace = performanceEnabled() ? new PerformanceTrace() : undefined;
        if (trace)
          logPerformance("metrics.start", { requestId: trace.id, range });
        try {
          const data = getCollector().dashboard(range, trace);
          if (!trace)
            return Response.json(data, {
              headers: { "Cache-Control": "no-store" },
            });
          const body = trace.measure("serialize", () => JSON.stringify(data));
          const responseBytes = Buffer.byteLength(body);
          const response = new Response(body, {
            headers: {
              "Cache-Control": "no-store",
              "Content-Type": "application/json",
              "X-Sentinel-Perf": trace.id,
              "Server-Timing": Object.entries(trace.timings)
                .map(([name, ms]) => `${name};dur=${ms}`)
                .join(", "),
            },
          });
          trace.finish({
            range,
            window: data.window,
            storedSamples: data.storage.count,
            databaseBytes: data.storage.bytes,
            historyPoints: data.history.length,
            responseBytes,
            status: 200,
          });
          return response;
        } catch (error) {
          trace?.finish({ range, status: 500 });
          throw error;
        }
      },
      POST: async ({ request }) => {
        const { receiveBrowserPerformance } =
          await import("@/server/performance.server");
        return receiveBrowserPerformance(request);
      },
    },
  },
});
