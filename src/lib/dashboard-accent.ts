export const dashboardAccents = [
  { value: "green", label: "Green", color: "#18794e" },
  { value: "blue", label: "Blue", color: "#1d62c6" },
  { value: "violet", label: "Violet", color: "#7545b8" },
  { value: "amber", label: "Amber", color: "#966015" },
  { value: "rose", label: "Rose", color: "#b83e65" },
  { value: "neutral", label: "Neutral", color: "var(--foreground)" },
] as const;

export type DashboardAccent = (typeof dashboardAccents)[number]["value"];
export const accentStorageKey = "sentinel.dashboard-accent.v1";
export const defaultAccent: DashboardAccent = "green";

export function isDashboardAccent(value: unknown): value is DashboardAccent {
  return dashboardAccents.some((accent) => accent.value === value);
}
