"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface ProjectState {
  projectId?: number;
  setProjectId: (id: number | undefined) => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      projectId: undefined,
      setProjectId: (projectId) => set({ projectId }),
    }),
    {
      name: "aerolog-project",
      storage: createJSONStorage(() => (typeof window === "undefined" ? noopStorage : localStorage)),
    },
  ),
);

const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};
