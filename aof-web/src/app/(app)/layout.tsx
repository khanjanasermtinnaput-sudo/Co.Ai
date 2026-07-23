import { Sidebar } from "@/components/layout/sidebar";
import { MobileTopbar, MobileNavDrawer } from "@/components/layout/mobile-nav";
import { AmbientBackground } from "@/components/layout/ambient-background";
import { AuthGate } from "@/components/providers/auth-gate";
import { KeyboardShortcuts } from "@/components/providers/keyboard-shortcuts";
import { CommandPalette } from "@/components/command-palette/command-palette";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <KeyboardShortcuts />
      <CommandPalette />
      <MobileNavDrawer />
      <div className="relative flex h-dvh overflow-hidden">
        <AmbientBackground />
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileTopbar />
          <main id="main" className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </AuthGate>
  );
}
