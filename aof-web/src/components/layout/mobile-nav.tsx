"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Menu, Plus, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { PRIMARY_NAV } from "@/lib/constants";
import { useUIStore } from "@/store/ui-store";
import { useChatStore } from "@/store/chat-store";
import { Logo } from "@/components/brand/logo";
import { NavLink } from "./nav-link";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { Settings } from "lucide-react";
import { isCoCodeArea, CoChatHistoryPanel, CoCodeHistoryPanel } from "./sidebar";

export function MobileTopbar() {
  const open = useUIStore((s) => s.mobileNavOpen);
  const setOpen = useUIStore((s) => s.setMobileNav);
  const pathname = usePathname();
  const router = useRouter();
  const selectConversation = useChatStore((s) => s.selectConversation);
  const inCoCode = isCoCodeArea(pathname);

  // Close the drawer whenever navigation completes.
  useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);

  const startNewChat = () => {
    selectConversation(null);
    setOpen(false);
    router.push("/");
  };

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-xl lg:hidden">
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col gap-3 border-r border-sidebar-border bg-sidebar p-3 shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left">
            <VisuallyHidden>
              <Dialog.Title>Navigation</Dialog.Title>
            </VisuallyHidden>
            <div className="flex h-11 items-center justify-between px-1">
              <Logo size={30} />
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                  aria-label="Close navigation"
                >
                  <X className="size-5" />
                </button>
              </Dialog.Close>
            </div>

            <button
              type="button"
              onClick={startNewChat}
              className="flex h-11 w-full items-center gap-2 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground shadow-glow-sm"
            >
              <Plus className="size-5" /> New Chat
            </button>

            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto pt-2">
              <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                Workspace
              </p>
              {PRIMARY_NAV.map((item) => (
                <NavLink
                  key={item.key}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  expanded
                  exact={item.href === "/"}
                  onNavigate={() => setOpen(false)}
                />
              ))}
              {inCoCode ? <CoCodeHistoryPanel /> : <CoChatHistoryPanel pathname={pathname} />}

              <div className="mt-auto" />
              <NavLink
                href="/settings"
                label="Settings"
                icon={Settings}
                expanded
                onNavigate={() => setOpen(false)}
              />
            </nav>

            <div className="flex flex-col gap-1 border-t border-sidebar-border pt-3">
              <ThemeToggle expanded />
              <UserMenu expanded />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Link href="/" className="inline-flex min-h-11 min-w-11 items-center" aria-label="Co.AI home">
        <Logo size={28} />
      </Link>

      <button
        type="button"
        onClick={startNewChat}
        className="ml-auto flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-glow-sm"
        aria-label="New chat"
      >
        <Plus className="size-5" />
      </button>
    </header>
  );
}
