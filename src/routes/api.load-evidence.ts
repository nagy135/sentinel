import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/load-evidence")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const raw = new URL(request.url).searchParams.get("at");
        if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
          return Response.json(
            { error: "A valid timestamp is required." },
            { status: 400 },
          );
        const { getCollector } = await import("@/server/collector.server");
        return Response.json(getCollector().store.loadEvidence(Number(raw)), {
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
