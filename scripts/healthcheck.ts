const port = process.env.PORT ?? "3000";
try {
  const response = await fetch(
    `http://127.0.0.1:${port}/api/metrics?range=15m`,
    {
      signal: AbortSignal.timeout(4000),
    },
  );
  if (!response.ok) process.exit(1);
  const data = await response.json();
  const maxAge = Math.max(data.collector.intervalMs * 3, 15000);
  const healthy =
    data.collector.running &&
    !data.collector.error &&
    data.latest &&
    Date.now() - data.latest.timestamp <= maxAge;
  process.exit(healthy ? 0 : 1);
} catch {
  process.exit(1);
}
export {};
