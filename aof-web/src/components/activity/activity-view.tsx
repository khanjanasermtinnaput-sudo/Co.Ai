"use client";

// ── Activity ──────────────────────────────────────────────────────────────────
// A real composition of existing data — recent chats, recent projects, and
// today's usage — nothing fabricated. Each section has its own honest empty
// state; guest/offline users still see whatever is genuinely available
// locally (chat-store and project-store both work without a backend).

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, FolderKanban, Activity as ActivityIcon } from "lucide-react";
import { timeAgo } from "@/lib/utils";
import { useChatStore } from "@/store/chat-store";
import { useProjectStore } from "@/store/project-store";
import { UsageDashboard } from "@/components/billing/usage-dashboard";
import { ProjectCard } from "@/components/projects/project-card";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const RECENT_CHATS_LIMIT = 6;
const RECENT_PROJECTS_LIMIT = 4;

export function ActivityView() {
  const conversations = useChatStore((s) => s.conversations);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const loadRemoteConversations = useChatStore((s) => s.loadRemoteConversations);
  const projects = useProjectStore((s) => s.projects);
  const loadProjects = useProjectStore((s) => s.load);
  const router = useRouter();

  useEffect(() => {
    loadRemoteConversations();
    void loadProjects();
  }, [loadRemoteConversations, loadProjects]);

  const recentChats = [...conversations]
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    .slice(0, RECENT_CHATS_LIMIT);

  const recentProjects = [...projects]
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    .slice(0, RECENT_PROJECTS_LIMIT);

  const openChat = (id: string) => {
    selectConversation(id);
    router.push("/");
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6 lg:py-9">
      <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
        <ActivityIcon className="size-6 text-primary" />
        Activity
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Recent chats, recent projects, and today&apos;s usage — all in one place.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <MessageSquare className="size-4" /> Recent chats
          </h2>
          {recentChats.length === 0 ? (
            <EmptySection
              icon={MessageSquare}
              title="No conversations yet"
              body="Start a chat and it'll show up here."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {recentChats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openChat(c.id)}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/30 hover:bg-card/80"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {c.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(c.updatedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <FolderKanban className="size-4" /> Recent projects
          </h2>
          {recentProjects.length === 0 ? (
            <EmptySection
              icon={FolderKanban}
              title="No projects yet"
              body="Build something in CoCode and it'll show up here."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {recentProjects.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Usage</h2>
        <UsageDashboard />
      </section>
    </div>
  );
}

function EmptySection({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof MessageSquare;
  title: string;
  body: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="size-4 text-muted-foreground" /> {title}
        </CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
    </Card>
  );
}
