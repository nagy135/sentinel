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
        return Response.json(getCollector().dashboard(range), {
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
