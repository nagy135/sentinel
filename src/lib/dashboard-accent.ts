export const dashboardAccents = [
  { value: "green", label: "Green", color: "#18794e" },
  { value: "blue", label: "Blue", color: "#1d62c6" },
  { value: "violet", label: "Violet", color: "#7545b8" },
  { value: "amber", label: "Amber", color: "#966015" },
  { value: "rose", label: "Rose", color: "#b83e65" },
  { value: "teal", label: "Teal", color: "#0d756c" },
  { value: "cyan", label: "Cyan", color: "#0c708d" },
  { value: "indigo", label: "Indigo", color: "#4f50b5" },
  { value: "pink", label: "Pink", color: "#a83c89" },
  { value: "orange", label: "Orange", color: "#ae5018" },
  { value: "lime", label: "Lime", color: "#4e741c" },
  { value: "neutral", label: "Neutral", color: "var(--foreground)" },
] as const;

export type DashboardAccent = (typeof dashboardAccents)[number]["value"];
export const accentStorageKey = "sentinel.dashboard-accent.v1";
export const defaultAccent: DashboardAccent = "green";
export const surfaceStorageKey = "sentinel.dashboard-surface.v1";
export const defaultSurface: DashboardAccent = "neutral";

export function isDashboardAccent(value: unknown): value is DashboardAccent {
  return dashboardAccents.some((accent) => accent.value === value);
}
