import { Providers } from "@/app/providers";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <DashboardShell>{children}</DashboardShell>
    </Providers>
  );
}
