import { lstat, readFile, readlink, statfs } from "node:fs/promises";
import { join } from "node:path";
import type { DiskMetric } from "../lib/metrics";

// Absolute symlinks in a mounted root must resolve inside that root. NixOS,
// for example, links /etc/os-release through /etc/static into /nix/store.
async function readHostFile(root: string, path: string) {
  const remaining = path.split("/").filter(Boolean);
  const resolved: string[] = [];
  let links = 0;
  while (remaining.length) {
    const part = remaining.shift()!;
    if (part === ".") continue;
    if (part === "..") {
      resolved.pop();
      continue;
    }
    const file = join(root, ...resolved, part);
    if ((await lstat(file)).isSymbolicLink()) {
      if (++links > 40) throw new Error("Too many host filesystem symlinks");
      const target = await readlink(file);
      if (target.startsWith("/")) resolved.length = 0;
      remaining.unshift(...target.split("/").filter(Boolean));
    } else resolved.push(part);
  }
  return readFile(join(root, ...resolved), "utf8");
}

// Read host identity without executing shell content from os-release.
export async function readHostIdentity(root: string) {
  let content: string;
  try {
    content = await readHostFile(root, "/etc/os-release");
  } catch {
    content = await readHostFile(root, "/usr/lib/os-release");
  }
  const fields = new Map<string, string>();
  for (const line of content.split("\n")) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    fields.set(match[1], value.replace(/\\(["\\$`])/g, "$1"));
  }
  if (!fields.get("NAME") && !fields.get("ID"))
    throw new Error(
      `No Linux host identity found under ${root}. Mount the host root read-only there.`,
    );
  return {
    os: fields.get("NAME") ?? fields.get("ID")!,
    release: fields.get("VERSION_ID") ?? "",
  };
}

export async function hostDisks(
  disks: DiskMetric[],
  root: string,
): Promise<DiskMetric[]> {
  const prefix = root === "/" ? "/" : `${root}/`;
  const mapped = disks
    .filter((disk) => disk.mount === root || disk.mount.startsWith(prefix))
    .map((disk) => ({
      ...disk,
      mount: disk.mount === root ? "/" : `/${disk.mount.slice(prefix.length)}`,
    }));
  // df may omit /host as a duplicate of another bind mount. statfs always
  // measures the mounted host root, rather than the container's overlay layer.
  if (!mapped.some((disk) => disk.mount === "/")) {
    const stats = await statfs(root);
    const total = stats.blocks * stats.bsize;
    const used = (stats.blocks - stats.bfree) * stats.bsize;
    const available = stats.bavail * stats.bsize;
    mapped.unshift({
      filesystem: "Host root filesystem",
      mount: "/",
      type: "host",
      total,
      used,
      available,
      percent: used + available > 0 ? (used / (used + available)) * 100 : 0,
    });
  }
  return mapped;
}
