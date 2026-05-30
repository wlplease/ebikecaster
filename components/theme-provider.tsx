"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "amber" | "ocean";
type ThemeMode = "light" | "dark" | "amber" | "ocean" | "auto";

type ThemeContextType = {
  theme: Theme;
  themeMode: ThemeMode;
  toggleTheme: () => void;
  setThemeMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  themeMode: "dark",
  toggleTheme: () => {},
  setThemeMode: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function resolveAuto(): Theme {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  const hour = new Date().getHours();
  return hour >= 19 || hour < 7 ? "dark" : "light";
}

const ALL_MODES: ThemeMode[] = ["dark", "light", "amber", "ocean", "auto"];

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>("auto");
  const [theme, setTheme] = useState<Theme>(() => typeof window !== "undefined" ? resolveAuto() : "dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("nshell-theme") as ThemeMode | null;
      if (saved && ALL_MODES.includes(saved)) {
        setThemeModeState(saved);
        setTheme(saved === "auto" ? resolveAuto() : saved as Theme);
      }
    } catch {}
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || themeMode !== "auto") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const handler = () => setTheme(resolveAuto());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mounted, themeMode]);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("nshell-theme", themeMode);
    } catch {}
  }, [theme, themeMode, mounted]);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    setTheme(mode === "auto" ? resolveAuto() : mode as Theme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeModeState((prev) => {
      const idx = ALL_MODES.indexOf(prev);
      const next = ALL_MODES[(idx + 1) % ALL_MODES.length];
      setTheme(next === "auto" ? resolveAuto() : next as Theme);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, themeMode, toggleTheme, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
}
