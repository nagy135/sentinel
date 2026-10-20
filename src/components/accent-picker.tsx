import { Check } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { dashboardAccents } from "@/lib/dashboard-accent";

export function AccentPicker() {
  const { accent, setAccent, accentSaveError } = useTheme();
  return (
    <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border bg-card px-4 py-3">
      <legend className="sr-only">Dashboard accent</legend>
      <span aria-hidden="true" className="text-xs font-medium">
        Accent color
      </span>
      <div className="flex flex-wrap gap-2">
        {dashboardAccents.map(({ value, label, color }) => (
          <label key={value} className="relative cursor-pointer">
            <input
              type="radio"
              name="dashboard-accent"
              value={value}
              checked={accent === value}
              onChange={() => setAccent(value)}
              className="peer sr-only"
            />
            <span className="flex items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-xs text-muted-foreground peer-checked:border-primary/30 peer-checked:bg-accent peer-checked:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-card hover:bg-muted">
              <span
                className="flex size-5 items-center justify-center rounded-full"
                style={{
                  background: color,
                  color: value === "neutral" ? "var(--background)" : "white",
                }}
              >
                {accent === value && (
                  <Check className="size-3.5" aria-hidden="true" />
                )}
              </span>
              {label}
            </span>
          </label>
        ))}
      </div>
      <p role="status" className="text-[11px] text-muted-foreground">
        {accentSaveError
          ? "Accent lasts for this visit; browser storage is unavailable."
          : "Accent saved in this browser."}
      </p>
    </fieldset>
  );
}
