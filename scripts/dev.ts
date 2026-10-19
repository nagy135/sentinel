import { createServer } from "vite";
import { getCollector } from "../src/server/collector.server";

const collector = getCollector();
const vite = await createServer();
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await vite.close();
  await collector.stop();
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  await collector.start();
  await vite.listen();
  console.log(`\n  Sentinel · ${collector.host?.hostname}`);
  console.log(
    `  Sampling every ${collector.config.intervalMs / 1000}s · SQLite: ${collector.config.dbPath}`,
  );
  vite.printUrls();
} catch (error) {
  console.error("[sentinel] Startup failed:", error);
  await shutdown();
  process.exitCode = 1;
}
