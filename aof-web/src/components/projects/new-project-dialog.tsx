"use client";

import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ProjectType } from "@/lib/types";
import { useProjectStore } from "@/store/project-store";
import { checkUserAccess } from "@/lib/access";
import { useAuthStore } from "@/store/auth-store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { TYPE_META } from "./project-meta";

const TYPES = Object.keys(TYPE_META) as ProjectType[];

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const create = useProjectStore((s) => s.createProject);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<ProjectType>("web-app");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName("");
    setDescription("");
    setType("web-app");
  };

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Give your project a name");
      return;
    }
    // Guests must sign in before saving a project.
    const access = checkUserAccess("create-project");
    if (!access.allowed) {
      onOpenChange(false);
      useAuthStore.getState().openLoginModal(access.reason);
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    const p = await create({ name, description, type });
    setSubmitting(false);
    if (!p) {
      toast.error("Couldn't create project", { description: "Please try again." });
      return;
    }
    toast.success("Project created", { description: p.name });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create new project</DialogTitle>
          <DialogDescription>
            Start a fresh workspace. You can build it with Nexora Code any time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="proj-name">Name</Label>
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nova Landing Page"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="proj-desc">Description</Label>
            <Textarea
              id="proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What are you building?"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Type</Label>
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map((t) => {
                const meta = TYPE_META[t];
                const Icon = meta.icon;
                const selected = type === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-xs transition-all",
                      selected
                        ? "border-primary/50 bg-primary/10 text-foreground shadow-glow-sm"
                        : "border-border bg-background/40 text-muted-foreground hover:border-primary/30 hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("size-4", selected && "text-primary")} />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Creating…" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
