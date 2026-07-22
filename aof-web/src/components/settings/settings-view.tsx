"use client";

import {
  Activity,
  BarChart3,
  CreditCard,
  KeyRound,
  Palette,
  UserRound,
  Zap,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUIStore } from "@/store/ui-store";
import { UsageDashboard } from "@/components/billing/usage-dashboard";
import { AccountTab } from "./tabs/account-tab";
import { AppearanceTab } from "./tabs/appearance-tab";
import { KeysTab } from "./tabs/keys-tab";
import { DiagnosticsTab } from "./tabs/diagnostics-tab";
import { BillingTab } from "./tabs/billing-tab";
import { AdvancedTab } from "./tabs/advanced-tab";

export function SettingsView({ defaultTab = "account" }: { defaultTab?: string }) {
  const developerMode = useUIStore((s) => s.developerMode);

  // Diagnostics is developer tooling — the tab is hidden until Developer Mode
  // (Settings → Advanced) is on. A ?tab=diagnostics deep link with it off
  // falls back to Account rather than opening an empty pane.
  const tab = defaultTab === "diagnostics" && !developerMode ? "account" : defaultTab;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-7 sm:px-6 lg:py-9">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Manage your account, appearance and AI provider keys.
      </p>

      <Tabs key={tab} defaultValue={tab} className="mt-6">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="account">
            <UserRound className="size-4" /> Account
          </TabsTrigger>
          <TabsTrigger value="appearance">
            <Palette className="size-4" /> Appearance
          </TabsTrigger>
          <TabsTrigger value="keys">
            <KeyRound className="size-4" /> API Keys
          </TabsTrigger>
          <TabsTrigger value="usage">
            <BarChart3 className="size-4" /> Usage
          </TabsTrigger>
          <TabsTrigger value="billing">
            <CreditCard className="size-4" /> Billing
          </TabsTrigger>
          <TabsTrigger value="advanced">
            <Zap className="size-4" /> Advanced
          </TabsTrigger>
          {developerMode && (
            <TabsTrigger value="diagnostics">
              <Activity className="size-4" /> Diagnostics
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="account">
          <AccountTab />
        </TabsContent>
        <TabsContent value="appearance">
          <AppearanceTab />
        </TabsContent>
        <TabsContent value="keys">
          <KeysTab />
        </TabsContent>
        <TabsContent value="usage">
          <UsageDashboard />
        </TabsContent>
        <TabsContent value="billing">
          <BillingTab />
        </TabsContent>
        <TabsContent value="advanced">
          <AdvancedTab />
        </TabsContent>
        {developerMode && (
          <TabsContent value="diagnostics">
            <DiagnosticsTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
