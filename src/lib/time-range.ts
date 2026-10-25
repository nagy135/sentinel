import { isRange, type AbsoluteRange, type TimeRange } from "./metrics";

export function formatRangeDuration({ from, to }: AbsoluteRange): string {
  let seconds = Math.floor((to - from) / 1000);
  if (seconds < 1) return "less than a second";
  const parts: string[] = [];
  for (const [unit, size] of [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ] as const) {
    const count = Math.floor(seconds / size);
    if (count) parts.push(`${count} ${unit}${count === 1 ? "" : "s"}`);
    seconds %= size;
  }
  return parts.join(", ");
}

export function validateAbsoluteRange(from: number, to: number): AbsoluteRange {
  if (
    ![from, to].every(
      (value) => Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15,
    )
  ) {
    throw new Error("Enter valid start and end dates.");
  }
  if (from >= to) throw new Error("Start time must be before end time.");
  return { from, to };
}

export function parseTimeRange(params: URLSearchParams): TimeRange {
  const hasBounds = params.has("from") || params.has("to");
  const range = params.get("range") ?? (hasBounds ? "custom" : "1h");
  if (range === "custom") {
    const from = params.get("from") ?? "";
    const to = params.get("to") ?? "";
    if (!/^\d+$/.test(from) || !/^\d+$/.test(to))
      throw new Error(
        "Custom ranges require from and to as epoch milliseconds.",
      );
    return validateAbsoluteRange(Number(from), Number(to));
  }
  if (!isRange(range) || hasBounds) throw new Error("Invalid time range.");
  return range;
}

export function timeRangeQuery(range: TimeRange): string {
  return typeof range === "string"
    ? `range=${range}`
    : `range=custom&from=${range.from}&to=${range.to}`;
}

// datetime-local uses the browser's local timezone, not UTC.
export function toLocalDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
