"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Moon, PanelLeft, PanelLeftClose, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";

export function TopHeader() {
  const projectId = useProjectStore((s) => s.projectId);
  const setProjectId = useProjectStore((s) => s.setProjectId);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);

  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });

  const projects = data?.data || [];

  // 项目列表加载完成后，如果 store 中没有选中的项目，自动选第一个
  useEffect(() => {
    if (!projectId && projects.length) {
      setProjectId(projects[0].id);
    }
    if (projectId && projects.length && !projects.find((p) => p.id === projectId)) {
      setProjectId(projects[0].id);
    }
  }, [projects, projectId, setProjectId]);

  return (
    <header className="sticky top-0 z-30 hidden h-14 items-center justify-between border-b bg-card/90 px-4 backdrop-blur lg:flex">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          className="h-9 w-9"
        >
          {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">项目</span>
          <Select
            value={projectId ? String(projectId) : undefined}
            onValueChange={(v) => setProjectId(Number(v))}
          >
            <SelectTrigger className="h-9 w-56">
              <SelectValue placeholder={isLoading ? "加载中..." : "选择项目"} />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={String(project.id)}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-muted-foreground sm:inline">{theme === "dark" ? "暗色" : "浅色"}</span>
        <Button
          variant="outline"
          size="icon"
          onClick={toggleTheme}
          aria-label="切换主题"
          className="h-9 w-9"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>
    </header>
  );
}
