"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface ProjectState {
  projectId?: number;
  dataSource: "sensorsdata" | "aerolog";
  setProjectId: (id: number | undefined) => void;
  setDataSource: (source: "sensorsdata" | "aerolog") => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      projectId: undefined,
      dataSource: "sensorsdata",
      setProjectId: (projectId) => set({ projectId }),
      setDataSource: (dataSource) => set({ dataSource }),
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
