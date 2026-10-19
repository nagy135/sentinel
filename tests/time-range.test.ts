import { expect, test } from "bun:test";
import {
  parseTimeRange,
  timeRangeQuery,
  validateAbsoluteRange,
  toLocalDateTime,
} from "../src/lib/time-range";

test("accepts presets and round-trips exact epoch millisecond ranges", () => {
  expect(parseTimeRange(new URLSearchParams())).toBe("1h");
  expect(parseTimeRange(new URLSearchParams("range=15m"))).toBe("15m");
  const selected = { from: 1_792_420_123_456, to: 1_792_421_234_567 };
  expect(parseTimeRange(new URLSearchParams(timeRangeQuery(selected)))).toEqual(
    selected,
  );
  expect(parseTimeRange(new URLSearchParams("from=0&to=1000"))).toEqual({
    from: 0,
    to: 1000,
  });
});

test("rejects incomplete, reversed, mixed and invalid ranges", () => {
  for (const query of [
    "range=custom",
    "range=custom&from=1",
    "from=1&to=1",
    "from=2&to=1",
    "from=&to=2",
    "from=NaN&to=2",
    "from=1&to=Infinity",
    "from=-1&to=2",
    "from=1.5&to=2",
    "from=0&to=8640000000000001",
    "range=15m&from=1&to=2",
    "range=toString",
  ]) {
    expect(() => parseTimeRange(new URLSearchParams(query))).toThrow();
  }
  expect(() => validateAbsoluteRange(NaN, 100)).toThrow();
});

test("formats local datetime inputs without a UTC timezone shift", () => {
  const date = new Date(2026, 9, 19, 14, 15, 16);
  expect(toLocalDateTime(date.getTime())).toBe("2026-10-19T14:15:16");
  expect(new Date(toLocalDateTime(date.getTime())).getTime()).toBe(
    date.getTime(),
  );
});
