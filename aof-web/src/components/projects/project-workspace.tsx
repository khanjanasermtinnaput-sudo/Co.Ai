"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Code2,
  Eye,
  Rocket,
  ScrollText,
  Settings2,
  LayoutDashboard,
  GitBranch,
  Lock,
  Trash2,
} from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import type { Project, ProjectStatus } from "@/lib/types";
import { useProjectStore } from "@/store/project-store";
import { usePlan } from "@/hooks/use-plan";
import { getModelDisplayName } from "@/lib/model-branding";
import { TYPE_META, STATUS_META } from "./project-meta";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { LogoMark } from "@/components/brand/logo";

const STATUSES: ProjectStatus[] = ["active", "building", "review", "archived"];

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const loaded = useProjectStore((s) => s.loaded);
  const load = useProjectStore((s) => s.load);
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId));

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <LogoMark size={40} className="animate-pulse" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <h2 className="text-lg font-semibold">Project not found</h2>
        <p className="text-sm text-muted-foreground">
          It may have been deleted, or it belongs to another account.
        </p>
        <Button variant="secondary" onClick={() => router.push("/projects")}>
          <ArrowLeft className="size-4" /> Back to projects
        </Button>
      </div>
    );
  }

  const type = TYPE_META[project.type];
  const status = STATUS_META[project.status];
  const TypeIcon = type.icon;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      {/* header */}
      <button
        type="button"
        onClick={() => router.push("/projects")}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Projects
      </button>

      <div className="flex items-start gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl border border-white/10 bg-background/60 text-primary">
          <TypeIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{project.name}</h1>
          <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
            {project.description || "No description yet."}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant={status.variant} className="gap-1.5">
          <span className="size-1.5 rounded-full bg-current" /> {status.label}
        </Badge>
        <Badge variant="outline">{type.label}</Badge>
        <Badge variant="muted" className="gap-1">
          <Rocket className="size-3" /> Not deployed
        </Badge>
        <Badge variant="muted" className="gap-1">
          <GitBranch className="size-3" /> No repository
        </Badge>
      </div>

      {/* tabs */}
      <Tabs defaultValue="overview" className="mt-6">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="overview"><LayoutDashboard className="size-4" /> Overview</TabsTrigger>
          <TabsTrigger value="code"><Code2 className="size-4" /> Code</TabsTrigger>
          <TabsTrigger value="preview"><Eye className="size-4" /> Preview</TabsTrigger>
          <TabsTrigger value="deployments"><Rocket className="size-4" /> Deployments</TabsTrigger>
          <TabsTrigger value="logs"><ScrollText className="size-4" /> Logs</TabsTrigger>
          <TabsTrigger value="settings"><Settings2 className="size-4" /> Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab project={project} /></TabsContent>
        <TabsContent value="code"><CodeTab /></TabsContent>
        <TabsContent value="preview"><PreviewTab /></TabsContent>
        <TabsContent value="deployments"><DeploymentsTab /></TabsContent>
        <TabsContent value="logs"><LogsTab project={project} /></TabsContent>
        <TabsContent value="settings"><SettingsTab project={project} /></TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab({ project }: { project: Project }) {
  const rows: Array<[string, string]> = [
    ["Framework", TYPE_META[project.type].label],
    ["Status", STATUS_META[project.status].label],
    ["Created", new Date(project.createdAt).toLocaleDateString()],
    ["Last updated", timeAgo(project.updatedAt)],
    ["Built with", project.mode ? getModelDisplayName(project.mode) : "—"],
    ["Deployment", "Not deployed"],
    ["Repository", "Not connected"],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Overview</CardTitle>
        <CardDescription>{project.description || "No description yet."}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between border-b border-border/50 pb-2 text-sm">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  cta,
}: {
  icon: typeof Code2;
  title: string;
  body: string;
  cta?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-background/60 text-primary">
          <Icon className="size-6" />
        </span>
        <div>
          <p className="font-medium">{title}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
        </div>
        {cta}
      </CardContent>
    </Card>
  );
}

function CodeTab() {
  return (
    <EmptyState
      icon={Code2}
      title="No code yet"
      body="Generate and edit this project's code in the CoCode workspace. Files you build there will show up here."
      cta={
        <Link href="/code" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground">
          <Code2 className="size-4" /> Open in CoCode
        </Link>
      }
    />
  );
}

function PreviewTab() {
  return (
    <EmptyState
      icon={Eye}
      title="Nothing to preview"
      body="Once this project has generated HTML/CSS/JS, a live in-browser preview with console & error capture appears here."
      cta={
        <Link href="/code" className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3.5 py-2 text-sm font-medium text-foreground">
          <Code2 className="size-4" /> Build it first
        </Link>
      }
    />
  );
}

function DeploymentsTab() {
  const { can } = usePlan();
  const deployable = can("deploy");
  return (
    <EmptyState
      icon={deployable ? Rocket : Lock}
      title={deployable ? "No deployments yet" : "Deployment is a Pro feature"}
      body={
        deployable
          ? "Connect a provider (Vercel, Netlify, Cloudflare Pages or GitHub Pages) to deploy this project and get a live URL."
          : "Upgrade to Pro to connect deployment providers and ship your project to a live URL."
      }
      cta={
        <Link
          href={deployable ? "/settings" : "/settings?tab=billing"}
          className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3.5 py-2 text-sm font-medium text-foreground"
        >
          {deployable ? "Connect a provider" : "See Pro plan"}
        </Link>
      }
    />
  );
}

function LogsTab({ project }: { project: Project }) {
  const events = [
    { at: project.updatedAt, label: "Project last updated" },
    { at: project.createdAt, label: "Project created" },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>Build &amp; deployment logs will stream here.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {events.map((e, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
              <div>
                <p className="text-foreground">{e.label}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(e.at).toLocaleString()} · {timeAgo(e.at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function SettingsTab({ project }: { project: Project }) {
  const router = useRouter();
  const updateProject = useProjectStore((s) => s.updateProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [statusVal, setStatusVal] = useState<ProjectStatus>(project.status);
  const [saving, setSaving] = useState(false);

  const dirty =
    name.trim() !== project.name ||
    description !== project.description ||
    statusVal !== project.status;

  const save = async () => {
    if (!name.trim()) {
      toast.error("Give your project a name");
      return;
    }
    setSaving(true);
    await updateProject(project.id, { name: name.trim(), description, status: statusVal });
    setSaving(false);
    toast.success("Project updated");
  };

  const remove = async () => {
    await deleteProject(project.id);
    toast.success("Project deleted");
    router.push("/projects");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Project settings</CardTitle>
          <CardDescription>Rename, edit the description, or change the status.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="proj-name">Name</Label>
            <Input id="proj-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proj-desc">Description</Label>
            <Textarea id="proj-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusVal(s)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                    statusVal === s
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {STATUS_META[s].label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={save} disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Delete project</CardTitle>
          <CardDescription>This permanently removes the project. This can&apos;t be undone.</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-end">
          <Button variant="destructive" onClick={remove}>
            <Trash2 className="size-4" /> Delete project
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
