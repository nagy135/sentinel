import { afterEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostDisks, readHostIdentity } from "../src/server/host.server";
import type { DiskMetric } from "../src/lib/metrics";

const directories: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sentinel-host-"));
  directories.push(root);
  return root;
}
afterEach(() => {
  for (const root of directories.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test("reads the mounted host OS through NixOS absolute symlinks without reading the container OS", async () => {
  const root = fixture();
  mkdirSync(join(root, "etc"));
  mkdirSync(join(root, "nix/store/system/etc"), { recursive: true });
  symlinkSync("/etc/static/os-release", join(root, "etc/os-release"));
  symlinkSync("/nix/store/system/etc", join(root, "etc/static"));
  writeFileSync(
    join(root, "nix/store/system/etc/os-release"),
    'NAME="NixOS"\nVERSION_ID="26.11"\n',
  );
  expect(await readHostIdentity(root)).toEqual({
    os: "NixOS",
    release: "26.11",
  });
});

test("supports relative os-release symlinks and rejects an unmounted host", async () => {
  const root = fixture();
  mkdirSync(join(root, "etc"));
  mkdirSync(join(root, "usr/lib"), { recursive: true });
  symlinkSync("../usr/lib/os-release", join(root, "etc/os-release"));
  writeFileSync(
    join(root, "usr/lib/os-release"),
    "ID=test-linux\nVERSION_ID=1\n",
  );
  expect(await readHostIdentity(root)).toEqual({
    os: "test-linux",
    release: "1",
  });
  await expect(readHostIdentity(fixture())).rejects.toThrow();
});

test("maps only host volumes and measures the host root when df omits a duplicate bind mount", async () => {
  const root = fixture();
  const disk = (mount: string): DiskMetric => ({
    filesystem: "/dev/test",
    type: "ext4",
    mount,
    total: 100,
    used: 40,
    available: 60,
    percent: 40,
  });
  const existing = await hostDisks(
    [disk("/"), disk(root), disk(`${root}/home`), disk(`${root}-other`)],
    root,
  );
  expect(existing.map((volume) => volume.mount)).toEqual(["/", "/home"]);
  expect(existing[0].filesystem).toBe("/dev/test");
  const fallback = await hostDisks([disk("/"), disk("/data")], root);
  const stats = await statfs(root);
  expect(fallback).toHaveLength(1);
  expect(fallback[0].mount).toBe("/");
  expect(fallback[0].total).toBe(stats.blocks * stats.bsize);
  expect(fallback[0].filesystem).toBe("Host root filesystem");
});
