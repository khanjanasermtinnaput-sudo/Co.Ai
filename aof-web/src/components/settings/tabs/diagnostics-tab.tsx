"use client";

import { Activity, TerminalSquare } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProviderStatusPanel } from "@/components/diagnostics/provider-status-panel";
import {
  SystemDiagnosticsPanel,
  ErrorLogPanel,
  DebugLogsPanel,
} from "@/components/diagnostics/system-diagnostics";
import { AuthDebugPanel } from "@/components/diagnostics/auth-debug-panel";

/** Deep technical tooling (system health, auth-chain tracer, provider matrix,
 *  raw logs). Gated behind Developer Mode — normal users should never wade
 *  through an auth debugger; the switch itself lives in Settings → Advanced. */
export function DiagnosticsTab() {
  const developerMode = useUIStore((s) => s.developerMode);
  const setDeveloperMode = useUIStore((s) => s.setDeveloperMode);

  if (!developerMode) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-4 text-primary" /> Diagnostics
          </CardTitle>
          <CardDescription>
            System health checks, provider status, auth debugging and raw error
            logs are developer tools. Turn on Developer Mode to see them.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TerminalSquare className="size-4" /> Developer Mode is off
          </div>
          <Button variant="secondary" onClick={() => setDeveloperMode(true)}>
            Enable Developer Mode
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Full system health with error codes */}
      <SystemDiagnosticsPanel />

      {/* Step-by-step auth chain debug — diagnoses AUTH-401 root cause */}
      <AuthDebugPanel />

      {/* AI provider health */}
      <ProviderStatusPanel />

      {/* Debug log category toggles */}
      <DebugLogsPanel />

      {/* In-session error log */}
      <ErrorLogPanel />
    </div>
  );
}
