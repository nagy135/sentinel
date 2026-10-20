import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleAuth } = await import("@/server/auth-http.server");
        return handleAuth(request, "login");
      },
    },
  },
});
