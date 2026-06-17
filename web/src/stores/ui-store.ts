"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ThemeMode = "light" | "dark";

interface UIState {
  theme: ThemeMode;
  sidebarCollapsed: boolean;
  hydrated: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setHydrated: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      theme: "light",
      sidebarCollapsed: false,
      hydrated: false,
      setTheme: (theme) => {
        applyThemeClass(theme);
        set({ theme });
      },
      toggleTheme: () => {
        const next = get().theme === "light" ? "dark" : "light";
        applyThemeClass(next);
        set({ theme: next });
      },
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: "aerolog-ui",
      storage: createJSONStorage(() => (typeof window === "undefined" ? noopStorage : localStorage)),
      partialize: (state) => ({ theme: state.theme, sidebarCollapsed: state.sidebarCollapsed }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyThemeClass(state.theme);
          state.setHydrated();
        }
      },
    },
  ),
);

function applyThemeClass(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
    root.style.colorScheme = "dark";
  } else {
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  }
}

const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};
