export function bytes(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index =
    value > 0
      ? Math.max(
          0,
          Math.min(
            Math.floor(Math.log(value) / Math.log(1024)),
            units.length - 1,
          ),
        )
      : 0;
  return `${(value / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: digits })} ${units[index]}`;
}
export const rate = (value: number | null | undefined) =>
  value == null ? "—" : `${bytes(value)}/s`;
export const pct = (value: number | null | undefined) =>
  value == null ? "—" : `${value.toFixed(1)}%`;
export function duration(seconds: number | undefined) {
  if (seconds == null) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days
    ? `${days}d ${hours}h`
    : hours
      ? `${hours}h ${minutes}m`
      : `${minutes}m`;
}
