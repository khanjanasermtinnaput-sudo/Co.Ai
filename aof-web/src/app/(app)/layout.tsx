import { Sidebar } from "@/components/layout/sidebar";
import { MobileTopbar } from "@/components/layout/mobile-nav";
import { AmbientBackground } from "@/components/layout/ambient-background";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-dvh overflow-hidden">
      <AmbientBackground />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopbar />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
