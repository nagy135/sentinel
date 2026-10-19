import { isAbsolute, resolve } from "node:path";

export function readConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const intervalMs = Number(env.SENTINEL_INTERVAL_MS ?? 5000);
  const port = Number(env.PORT ?? 3000);
  const hostname = env.SENTINEL_HOST ?? "127.0.0.1";
  const hostRoot = env.SENTINEL_HOST_ROOT;
  if (hostRoot !== undefined && (!hostRoot || !isAbsolute(hostRoot)))
    throw new Error(
      "SENTINEL_HOST_ROOT must be an absolute mounted host path.",
    );
  if (!["127.0.0.1", "0.0.0.0"].includes(hostname))
    throw new Error("SENTINEL_HOST must be 127.0.0.1 or 0.0.0.0.");
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000) {
    throw new Error(
      "SENTINEL_INTERVAL_MS must be an integer of at least 1000 (one second).",
    );
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer between 1 and 65535.");
  return {
    intervalMs,
    port,
    hostname,
    hostRoot: hostRoot ? resolve(hostRoot) : null,
    dbPath: resolve(env.SENTINEL_DB_PATH || "./data/sentinel.sqlite"),
  };
}
