import { Check } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { dashboardAccents, type DashboardAccent } from "@/lib/dashboard-accent";

function ColorRow({
  name,
  title,
  description,
  value,
  onChange,
}: {
  name: string;
  title: string;
  description: string;
  value: DashboardAccent;
  onChange: (value: DashboardAccent) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-medium">{title}</legend>
      <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {dashboardAccents.map(({ value: option, label, color }) => (
          <label key={option} className="relative cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="peer sr-only"
            />
            <span className="flex items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-xs text-muted-foreground peer-checked:border-primary/30 peer-checked:bg-accent peer-checked:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-card hover:bg-muted">
              <span
                className="flex size-5 items-center justify-center rounded-full"
                style={{
                  background: color,
                  color: option === "neutral" ? "var(--background)" : "white",
                }}
              >
                {value === option && (
                  <Check className="size-3.5" aria-hidden="true" />
                )}
              </span>
              {label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AccentPicker() {
  const {
    accent,
    setAccent,
    accentSaveError,
    surface,
    setSurface,
    surfaceSaveError,
  } = useTheme();
  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <ColorRow
        name="dashboard-accent"
        title="Accent color"
        description="Buttons, highlights, and charts."
        value={accent}
        onChange={setAccent}
      />
      <div className="border-t pt-4">
        <ColorRow
          name="dashboard-surface"
          title="Background color"
          description="Page, cards, header, and borders. Mix with any accent."
          value={surface}
          onChange={setSurface}
        />
      </div>
      <p role="status" className="text-[11px] text-muted-foreground">
        {accentSaveError || surfaceSaveError
          ? "Some colors last for this visit; browser storage is unavailable."
          : "Colors saved in this browser. Logo and status colors stay green."}
      </p>
    </div>
  );
}
