"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Menu, Plus, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { cn } from "@/lib/utils";
import { PRIMARY_NAV } from "@/lib/constants";
import { useUIStore } from "@/store/ui-store";
import { useChatStore } from "@/store/chat-store";
import { Logo } from "@/components/brand/logo";
import { NavLink } from "./nav-link";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { isCoCodeArea } from "./sidebar";
import { CoChatHistoryPanel } from "./chat-history-panel";
import { CoCodeHistoryPanel } from "./cocode-history-panel";

/** Hamburger button that opens the shared nav drawer — the drawer's open
 *  state lives in ui-store, so any page header (the phone-only unified chat
 *  header included) can trigger it without needing to be a Dialog.Trigger. */
export function MobileMenuButton({ className }: { className?: string }) {
  const setOpen = useUIStore((s) => s.setMobileNav);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
        className,
      )}
      aria-label="Open navigation"
    >
      <Menu className="size-5" />
    </button>
  );
}

/** The slide-in navigation drawer itself — no visible bar. Mounted once for
 *  every route (phone/tablet width) so any header's MobileMenuButton can open
 *  it via ui-store, regardless of whether that route also renders MobileTopbar. */
export function MobileNavDrawer() {
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
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col gap-3 border-r border-sidebar-border bg-sidebar p-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left">
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
            className="flex h-11 w-full items-center gap-2 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground"
          >
            <Plus className="size-5" /> New Chat
          </button>

          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto pt-2">
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
          </nav>

          <div className="flex flex-col gap-1 border-t border-sidebar-border pt-3">
            <ThemeToggle expanded />
            <UserMenu expanded />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Slim top bar (logo + hamburger + new chat) for every phone-width route
 *  except chat ("/") — the chat surface renders its own unified Claude-style
 *  header (hamburger + model + actions in one bar) instead of stacking two. */
export function MobileTopbar() {
  const pathname = usePathname();
  const router = useRouter();
  const selectConversation = useChatStore((s) => s.selectConversation);

  if (pathname === "/") return null;

  const startNewChat = () => {
    selectConversation(null);
    router.push("/");
  };

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-background px-3 pt-[env(safe-area-inset-top)] md:hidden">
      <MobileMenuButton />

      <Link href="/" className="inline-flex min-h-11 min-w-11 items-center" aria-label="Co.AI home">
        <Logo size={28} />
      </Link>

      <button
        type="button"
        onClick={startNewChat}
        className="ml-auto flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground"
        aria-label="New chat"
      >
        <Plus className="size-5" />
      </button>
    </header>
  );
}
