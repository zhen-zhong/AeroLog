"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AuthUser } from "@/lib/api";

interface AuthState {
  token: string;
  user?: AuthUser;
  hasHydrated: boolean;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
  setHasHydrated: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: "",
      user: undefined,
      hasHydrated: false,
      setAuth: (token, user) => set({ token, user }),
      clearAuth: () => set({ token: "", user: undefined }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: "aerolog-auth",
      storage: createJSONStorage(() => (typeof window === "undefined" ? noopStorage : localStorage)),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};
