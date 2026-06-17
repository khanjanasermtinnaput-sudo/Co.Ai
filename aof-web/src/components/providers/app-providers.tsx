"use client";

import * as React from "react";
import { Toaster } from "sonner";
import { ThemeProvider } from "./theme-provider";
import { AuthProvider } from "./auth-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/error-boundary";
import { LoginModal } from "@/components/auth/login-modal";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <AuthProvider>
        <TooltipProvider delayDuration={200} skipDelayDuration={400}>
          <ErrorBoundary>{children}</ErrorBoundary>
          <LoginModal />
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{
              classNames: {
                toast:
                  "glass-strong !border-border !text-foreground !rounded-xl",
                description: "!text-muted-foreground",
              },
            }}
          />
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
