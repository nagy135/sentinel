import { expect, test } from "bun:test";
import {
  defaultLayout,
  placeBlock,
  readLayout,
} from "../src/lib/dashboard-layout";

test("restores known unique blocks while respecting hidden blocks and an empty dashboard", () => {
  expect(
    readLayout(["cpu", "unknown", "cpu", "load-history", null, "toString"]),
  ).toEqual(["cpu", "load-history"]);
  expect(readLayout([])).toEqual([]);
  expect(readLayout({})).toEqual(defaultLayout);
  expect(readLayout(["memory", "cpu"])).toEqual(["memory", "cpu"]);
});

test("moves existing blocks into slots without duplicates or shifted indexes", () => {
  const layout = ["cpu", "memory", "network"] as const;
  expect(placeBlock([...layout], "cpu", 3)).toEqual([
    "memory",
    "network",
    "cpu",
  ]);
  expect(placeBlock([...layout], "network", 0)).toEqual([
    "network",
    "cpu",
    "memory",
  ]);
  expect(placeBlock([...layout], "memory", 1)).toEqual([...layout]);
  expect(placeBlock([...layout], "memory", 2)).toEqual([...layout]);
  expect(layout).toEqual(["cpu", "memory", "network"]);
});

test("inserts blocks from the library at a selected slot or at the end", () => {
  expect(placeBlock(["cpu", "memory"], "load-history", 1)).toEqual([
    "cpu",
    "load-history",
    "memory",
  ]);
  expect(placeBlock([], "temperature-history", 0)).toEqual([
    "temperature-history",
  ]);
  expect(placeBlock(["cpu"], "memory", 100)).toEqual(["cpu", "memory"]);
});
