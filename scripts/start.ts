import { fileURLToPath } from "node:url";
import { relative, sep } from "node:path";
import { closeAuth, getAuth } from "../src/server/auth.server";
import { getCollector } from "../src/server/collector.server";

const clientDirectory = fileURLToPath(
  new URL("../dist/client", import.meta.url),
);
const entryUrl = new URL("../dist/server/server.js", import.meta.url);
const { default: app } = await import(entryUrl.href);
const assets = new Map<string, ReturnType<typeof Bun.file>>();
for await (const path of new Bun.Glob("**/*").scan({
  cwd: clientDirectory,
  absolute: true,
  onlyFiles: true,
})) {
  assets.set(
    `/${relative(clientDirectory, path).split(sep).join("/")}`,
    Bun.file(path),
  );
}

const collector = getCollector();
let server: ReturnType<typeof Bun.serve> | undefined;
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await server?.stop();
  await collector.stop();
  await closeAuth();
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  await getAuth().ready;
  await collector.start();
  if (!shuttingDown) {
    server = Bun.serve({
      hostname: collector.config.hostname,
      port: collector.config.port,
      async fetch(request) {
        let pathname: string;
        try {
          pathname = decodeURIComponent(new URL(request.url).pathname);
        } catch {
          return new Response("Invalid URL", { status: 400 });
        }
        const file = assets.get(pathname);
        if (file) {
          if (request.method !== "GET" && request.method !== "HEAD") {
            return new Response("Method not allowed", {
              status: 405,
              headers: { Allow: "GET, HEAD" },
            });
          }
          return new Response(request.method === "HEAD" ? null : file, {
            headers: {
              "Content-Type": file.type,
              "Content-Length": String(file.size),
              "Cache-Control": pathname.startsWith("/assets/")
                ? "public, max-age=31536000, immutable"
                : "public, max-age=3600",
            },
          });
        }
        return app.fetch(request);
      },
      error(error) {
        console.error("[sentinel] Request failed:", error);
        return new Response("Internal server error", { status: 500 });
      },
    });
    console.log(
      `[sentinel] ${collector.host?.hostname} · http://${collector.config.hostname}:${server.port}`,
    );
    console.log(
      `[sentinel] Sampling every ${collector.config.intervalMs / 1000}s · SQLite: ${collector.config.dbPath}`,
    );
  }
} catch (error) {
  console.error("[sentinel] Startup failed:", error);
  await shutdown();
  process.exitCode = 1;
}
