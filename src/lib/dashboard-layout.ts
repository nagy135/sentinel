export const blockCatalog = {
  system: {
    title: "Detected system",
    description: "Host, processor, and uptime",
    size: "full",
  },
  cpu: {
    title: "CPU usage",
    description: "Current processor activity",
    size: "stat",
  },
  memory: {
    title: "Memory usage",
    description: "Active and total memory",
    size: "stat",
  },
  storage: {
    title: "Storage used",
    description: "Primary volume capacity",
    size: "stat",
  },
  network: {
    title: "Network traffic",
    description: "Current receive and send rates",
    size: "stat",
  },
  "cpu-history": {
    title: "CPU utilization",
    description: "CPU history and activity per core",
    size: "chart",
  },
  "memory-history": {
    title: "Memory utilization",
    description: "Memory history and swap usage",
    size: "chart",
  },
  "load-history": {
    title: "System load",
    description: "1, 5, and 15 minute load averages",
    size: "chart",
  },
  "temperature-history": {
    title: "CPU temperature",
    description: "CPU sensor history in degrees Celsius",
    size: "chart",
  },
  "network-history": {
    title: "Network throughput",
    description: "Receive and send history",
    size: "chart",
  },
  "storage-history": {
    title: "Storage utilization",
    description: "Primary volume usage over time",
    size: "chart",
  },
  volumes: {
    title: "Mounted volumes",
    description: "Usage and free space by filesystem",
    size: "detail",
  },
  interfaces: {
    title: "Network interfaces",
    description: "Traffic on each active connection",
    size: "detail",
  },
  information: {
    title: "System information",
    description: "Hardware and operating system details",
    size: "detail",
  },
} as const;
export type BlockId = keyof typeof blockCatalog;
export const defaultLayout = Object.keys(blockCatalog) as BlockId[];
export const layoutStorageKey = "sentinel.dashboard-layout.v1";
export function isBlockId(value: unknown): value is BlockId {
  return typeof value === "string" && Object.hasOwn(blockCatalog, value);
}
export function readLayout(value: unknown): BlockId[] {
  if (!Array.isArray(value)) return [...defaultLayout];
  return [...new Set(value.filter(isBlockId))];
}
// Slot indexes refer to the layout before removing the dragged block.
export function placeBlock(
  layout: BlockId[],
  id: BlockId,
  slot: number,
): BlockId[] {
  const from = layout.indexOf(id);
  const next = layout.filter((block) => block !== id);
  const index = Math.max(
    0,
    Math.min(next.length, slot - (from >= 0 && from < slot ? 1 : 0)),
  );
  next.splice(index, 0, id);
  return next;
}
