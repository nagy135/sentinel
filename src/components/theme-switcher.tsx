import { Monitor, Moon, Sun } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTheme, type Theme } from "@/components/theme-provider";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  return (
    <ToggleGroup
      type="single"
      value={theme}
      onValueChange={(value) => {
        if (value) setTheme(value as Theme);
      }}
      aria-label="Color theme"
      size="sm"
      className="rounded-lg border bg-card p-1"
    >
      {(
        [
          { value: "system", icon: Monitor, label: "System theme" },
          { value: "light", icon: Sun, label: "Light theme" },
          { value: "dark", icon: Moon, label: "Dark theme" },
        ] as const
      ).map(({ value, icon: Icon, label }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={label}
          title={label}
          className="h-7 rounded-md! px-2.5 text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-primary"
        >
          <Icon className="size-3.5" />
          <span className="sr-only">{label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
