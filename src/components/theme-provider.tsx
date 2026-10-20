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
  surfaceStorageKey,
  defaultSurface,
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
  surface: DashboardAccent;
  setSurface: (surface: DashboardAccent) => void;
  surfaceSaveError: boolean;
}>({
  theme: "system",
  setTheme: () => {},
  accent: defaultAccent,
  setAccent: () => {},
  accentSaveError: false,
  surface: defaultSurface,
  setSurface: () => {},
  surfaceSaveError: false,
});

// Runs before the first paint so a saved preference never flashes the wrong theme.
export const themeScript = `(function(){try{var t=localStorage.getItem('${storageKey}');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}})()`;
export const accentScript = `(function(){try{var a=localStorage.getItem('${accentStorageKey}');if(${JSON.stringify(dashboardAccents.map(({ value }) => value))}.includes(a))document.documentElement.dataset.accent=a}catch(e){}})()`;
export const surfaceScript = `(function(){var s='${defaultSurface}';try{var v=localStorage.getItem('${surfaceStorageKey}');if(${JSON.stringify(dashboardAccents.map(({ value }) => value))}.includes(v))s=v}catch(e){}document.documentElement.dataset.surface=s})()`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("system");
  const [accent, setAccent] = useState<DashboardAccent>(defaultAccent);
  const [accentSaveError, setAccentSaveError] = useState(false);
  const [surface, setSurface] = useState<DashboardAccent>(defaultSurface);
  const [surfaceSaveError, setSurfaceSaveError] = useState(false);
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
    try {
      const saved = localStorage.getItem(surfaceStorageKey);
      if (isDashboardAccent(saved)) setSurface(saved);
    } catch {
      setSurfaceSaveError(true);
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
  useEffect(() => {
    if (ready) document.documentElement.dataset.surface = surface;
  }, [surface, ready]);
  const changeAccent = (value: DashboardAccent) => {
    setAccent(value);
    try {
      localStorage.setItem(accentStorageKey, value);
      setAccentSaveError(false);
    } catch {
      setAccentSaveError(true);
    }
  };
  const changeSurface = (value: DashboardAccent) => {
    setSurface(value);
    try {
      localStorage.setItem(surfaceStorageKey, value);
      setSurfaceSaveError(false);
    } catch {
      setSurfaceSaveError(true);
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
        surface,
        setSurface: changeSurface,
        surfaceSaveError,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
