import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";

const authMiddleware = createMiddleware().server(async ({ request, next }) => {
  const { getAuth } = await import("./server/auth.server");
  const auth = getAuth();
  const pathname = new URL(request.url).pathname;
  if (
    pathname === "/healthz" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout"
  )
    return next();
  const authenticated = await auth.authenticated(request);
  if (!authenticated && pathname !== "/login") {
    if (
      pathname.startsWith("/api/") ||
      !["GET", "HEAD"].includes(request.method)
    )
      return Response.json(
        { error: "Authentication required." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    return new Response(null, {
      status: 302,
      headers: { Location: "/login", "Cache-Control": "no-store" },
    });
  }
  if (authenticated && pathname === "/login")
    return new Response(null, {
      status: 302,
      headers: { Location: "/", "Cache-Control": "no-store" },
    });
  const result = await next();
  result.response.headers.set("Cache-Control", "no-store");
  result.response.headers.append("Vary", "Cookie");
  result.response.headers.set("X-Content-Type-Options", "nosniff");
  result.response.headers.set("X-Frame-Options", "DENY");
  result.response.headers.set("Referrer-Policy", "no-referrer");
  if (authenticated)
    result.response.headers.append(
      "Set-Cookie",
      auth.cookie(request, auth.token(request)),
    );
  return result;
});
export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" }),
    authMiddleware,
  ],
}));
