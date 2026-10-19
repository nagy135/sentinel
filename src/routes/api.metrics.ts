import { createFileRoute } from "@tanstack/react-router";
import { isRange } from "@/lib/metrics";

export const Route = createFileRoute("/api/metrics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const range = new URL(request.url).searchParams.get("range") ?? "1h";
        if (!isRange(range))
          return Response.json(
            { error: "Invalid time range" },
            { status: 400 },
          );
        const { getCollector } = await import("@/server/collector.server");
        return Response.json(getCollector().dashboard(range), {
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
