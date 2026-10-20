const port = process.env.PORT ?? "3000";
try {
  const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) process.exit(1);
  const data = await response.json();
  const healthy = data.status === "ok";
  process.exit(healthy ? 0 : 1);
} catch {
  process.exit(1);
}
export {};
