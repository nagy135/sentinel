import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  accentStorageKey,
  dashboardAccents,
  defaultAccent,
  isDashboardAccent,
  type DashboardAccent,
} from "@/lib/dashboard-accent";

export type Theme = "system" | "light" | "dark";
const storageKey = "sentinel-theme";
const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
  accent: DashboardAccent;
  setAccent: (accent: DashboardAccent) => void;
  accentSaveError: boolean;
}>({
  theme: "system",
  setTheme: () => {},
  accent: defaultAccent,
  setAccent: () => {},
  accentSaveError: false,
});

// Runs before the first paint so a saved preference never flashes the wrong theme.
export const themeScript = `(function(){try{var t=localStorage.getItem('${storageKey}');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}})()`;
export const accentScript = `(function(){try{var a=localStorage.getItem('${accentStorageKey}');if(${JSON.stringify(dashboardAccents.map(({ value }) => value))}.includes(a))document.documentElement.dataset.accent=a}catch(e){}})()`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("system");
  const [accent, setAccent] = useState<DashboardAccent>(defaultAccent);
  const [accentSaveError, setAccentSaveError] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === "system" || saved === "dark" || saved === "light")
        setTheme(saved);
    } catch {
      /* Preferences still work when browser storage is unavailable. */
    }
    try {
      const saved = localStorage.getItem(accentStorageKey);
      if (isDashboardAccent(saved)) setAccent(saved);
    } catch {
      setAccentSaveError(true);
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme, ready]);
  useEffect(() => {
    if (ready) document.documentElement.dataset.accent = accent;
  }, [accent, ready]);
  const changeAccent = (value: DashboardAccent) => {
    setAccent(value);
    try {
      localStorage.setItem(accentStorageKey, value);
      setAccentSaveError(false);
    } catch {
      setAccentSaveError(true);
    }
  };
  const change = (value: Theme) => {
    setTheme(value);
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      /* Keep the in-memory preference. */
    }
  };
  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme: change,
        accent,
        setAccent: changeAccent,
        accentSaveError,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
