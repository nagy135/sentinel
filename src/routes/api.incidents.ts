import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/incidents")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const raw = new URL(request.url).searchParams.get("id");
        if (
          !raw ||
          !/^\d+$/.test(raw) ||
          !Number.isSafeInteger(Number(raw)) ||
          Number(raw) < 1
        )
          return Response.json(
            { error: "A valid incident id is required." },
            { status: 400 },
          );
        const { getCollector } = await import("@/server/collector.server");
        const detail = getCollector().store.incident(Number(raw));
        return Response.json(
          detail ?? { error: "Incident not found or expired." },
          {
            status: detail ? 200 : 404,
            headers: { "Cache-Control": "no-store" },
          },
        );
      },
    },
  },
});
