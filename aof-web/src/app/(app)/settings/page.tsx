import type { Metadata } from "next";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = { title: "Settings" };

const VALID_TABS = ["account", "appearance", "keys", "usage", "diagnostics", "billing"];

export default function SettingsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const tab = searchParams.tab && VALID_TABS.includes(searchParams.tab)
    ? searchParams.tab
    : "account";
  return <SettingsView defaultTab={tab} />;
}
