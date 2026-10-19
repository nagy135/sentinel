import { expect, test } from "bun:test";
import { readConfig } from "../src/server/config.server";
import { isRange } from "../src/lib/metrics";

test("uses a configurable interval with a five-second default", () => {
  expect(readConfig({}).intervalMs).toBe(5000);
  expect(readConfig({ SENTINEL_INTERVAL_MS: "12000" }).intervalMs).toBe(12000);
  for (const value of ["0", "-1", "abc", "1000.5", "Infinity"]) {
    expect(() => readConfig({ SENTINEL_INTERVAL_MS: value })).toThrow(
      "SENTINEL_INTERVAL_MS",
    );
  }
});

test("rejects unknown and inherited range names", () => {
  expect(isRange("all")).toBe(true);
  expect(isRange("15m")).toBe(true);
  expect(isRange("toString")).toBe(false);
  expect(isRange("__proto__")).toBe(false);
  expect(isRange("invalid")).toBe(false);
});

test("keeps native servers on localhost and allows explicit container binding", () => {
  expect(readConfig({}).hostname).toBe("127.0.0.1");
  expect(readConfig({ SENTINEL_HOST: "0.0.0.0" }).hostname).toBe("0.0.0.0");
  expect(() => readConfig({ SENTINEL_HOST: "" })).toThrow("SENTINEL_HOST");
  expect(() => readConfig({ SENTINEL_HOST: "example.com" })).toThrow(
    "SENTINEL_HOST",
  );
});

test("requires an explicit absolute path for mounted Linux host data", () => {
  expect(readConfig({}).hostRoot).toBeNull();
  expect(readConfig({ SENTINEL_HOST_ROOT: "/host/" }).hostRoot).toBe("/host");
  for (const path of ["", "host", "../host"])
    expect(() => readConfig({ SENTINEL_HOST_ROOT: path })).toThrow(
      "SENTINEL_HOST_ROOT",
    );
});
