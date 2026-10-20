import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      GET: async () => {
        const { getCollector } = await import("@/server/collector.server");
        const collector = getCollector();
        const latest = collector.store.latest();
        const healthy =
          collector.running &&
          !collector.error &&
          latest &&
          Date.now() - latest.timestamp <=
            Math.max(collector.config.intervalMs * 3, 15000);
        return Response.json(
          { status: healthy ? "ok" : "unavailable" },
          {
            status: healthy ? 200 : 503,
            headers: { "Cache-Control": "no-store" },
          },
        );
      },
    },
  },
});
