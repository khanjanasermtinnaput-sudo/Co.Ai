"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { getSupabase } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useChatStore } from "@/store/chat-store";
import { useProjectStore } from "@/store/project-store";

export function AccountTab() {
  const { user, configured, signOut } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const deleteAllConversations = useChatStore((s) => s.deleteAllConversations);
  const deleteAllProjects = useProjectStore((s) => s.deleteAllProjects);
  const [confirmDeleteChats, setConfirmDeleteChats] = useState(false);
  const [confirmDeleteProjects, setConfirmDeleteProjects] = useState(false);

  // Keep the form in sync with the signed-in user.
  useEffect(() => {
    if (user) setName(user.name);
  }, [user]);

  const email = user?.email ?? "you@aof.ai";

  const save = async () => {
    setSaving(true);
    const supabase = getSupabase();
    if (configured && supabase) {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: name },
      });
      setSaving(false);
      if (error) {
        toast.error("Couldn't save profile", { description: error.message });
        return;
      }
      toast.success("Profile saved");
      return;
    }
    setSaving(false);
    toast.success("Profile saved");
  };

  const handleLogout = async () => {
    await signOut();
    if (configured) router.replace("/login");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>How you appear across Co.AI.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Display name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} disabled readOnly />
            {configured && (
              <p className="text-xs text-muted-foreground">
                Your email comes from your Google account and can&apos;t be changed here.
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={handleLogout} className="gap-2">
              <LogOut className="size-4" /> Log out
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>Irreversible actions — CoChat and CoCode are cleared independently.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Delete all CoChat history</p>
              <p className="text-sm text-muted-foreground">Every chat, message, and CoChat memory. Cannot be undone.</p>
            </div>
            <Button variant="destructive" onClick={() => setConfirmDeleteChats(true)}>
              Delete all chats
            </Button>
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Delete all CoCode projects</p>
              <p className="text-sm text-muted-foreground">Every project and CoCode build memory. Cannot be undone.</p>
            </div>
            <Button variant="destructive" onClick={() => setConfirmDeleteProjects(true)}>
              Delete all projects
            </Button>
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Delete your account and all data.</p>
            <Button variant="destructive" onClick={() => toast("Contact support to delete your account")}>
              Delete account
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmDeleteChats}
        onOpenChange={setConfirmDeleteChats}
        title="Delete all CoChat history?"
        description="This permanently deletes every CoChat conversation, message, and CoChat memory. CoCode is not affected. This cannot be undone."
        confirmLabel="Delete all chats"
        onConfirm={() => {
          deleteAllConversations().catch(() => {});
        }}
      />
      <ConfirmDialog
        open={confirmDeleteProjects}
        onOpenChange={setConfirmDeleteProjects}
        title="Delete all CoCode projects?"
        description="This permanently deletes every CoCode project and CoCode build memory. CoChat is not affected. This cannot be undone."
        confirmLabel="Delete all projects"
        onConfirm={() => {
          deleteAllProjects().catch(() => {});
        }}
      />
    </div>
  );
}
