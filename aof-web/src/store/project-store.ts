import { create } from "zustand";
import { uid } from "@/lib/utils";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import type { CodeMode, Project, ProjectStatus, ProjectType } from "@/lib/types";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

// Seed data — only used in demo mode (no Supabase configured) so the offline
// experience still feels alive. In live mode projects come from the database.
const SEED: Project[] = [
  {
    id: uid("proj"),
    name: "Nova Landing Page",
    description: "Marketing site for a SaaS launch with waitlist + analytics.",
    type: "web-app",
    status: "active",
    pinned: true,
    mode: "pro",
    createdAt: daysAgo(12),
    updatedAt: daysAgo(0),
  },
  {
    id: uid("proj"),
    name: "Queue Booking System",
    description: "Barbershop appointment booking with reminders and admin.",
    type: "web-app",
    status: "building",
    pinned: true,
    mode: "titan",
    createdAt: daysAgo(20),
    updatedAt: daysAgo(1),
  },
  {
    id: uid("proj"),
    name: "Pixel Runner",
    description: "Endless-runner browser game with leaderboard.",
    type: "game",
    status: "review",
    pinned: false,
    mode: "1.0",
    createdAt: daysAgo(8),
    updatedAt: daysAgo(2),
  },
  {
    id: uid("proj"),
    name: "Invoice API",
    description: "REST service for invoices, PDF export and webhooks.",
    type: "api",
    status: "active",
    pinned: false,
    mode: "pro",
    createdAt: daysAgo(30),
    updatedAt: daysAgo(4),
  },
  {
    id: uid("proj"),
    name: "Study Buddy",
    description: "Spaced-repetition flashcards with AI-generated quizzes.",
    type: "mobile-app",
    status: "active",
    pinned: false,
    mode: "lite",
    createdAt: daysAgo(5),
    updatedAt: daysAgo(3),
  },
  {
    id: uid("proj"),
    name: "Market Research Brief",
    description: "Competitive analysis workspace for a fintech idea.",
    type: "research",
    status: "archived",
    pinned: false,
    createdAt: daysAgo(60),
    updatedAt: daysAgo(21),
  },
];

// ── Database row ↔ domain mapping ─────────────────────────────────────────────
interface ProjectRow {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  pinned: boolean;
  mode: string | null;
  created_at: string;
  updated_at: string;
}

function rowToProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    type: r.type as ProjectType,
    status: r.status as ProjectStatus,
    pinned: r.pinned,
    mode: (r.mode as CodeMode) ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface CreateInput {
  name: string;
  description: string;
  type: ProjectType;
  status?: ProjectStatus;
}

interface ProjectState {
  projects: Project[];
  query: string;
  loading: boolean;
  loaded: boolean;
  setQuery: (q: string) => void;
  /** Load projects for the current user (or seed data in demo mode). */
  load: () => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  createProject: (input: CreateInput) => Promise<Project | null>;
  updateProject: (
    id: string,
    patch: Partial<Pick<Project, "name" | "description" | "status" | "type">>,
  ) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  query: "",
  loading: false,
  loaded: false,

  setQuery: (query) => set({ query }),

  load: async () => {
    // Demo mode — no backend, just show the seed projects.
    if (!isSupabaseConfigured()) {
      set({ projects: SEED, loading: false, loaded: true });
      return;
    }

    const supabase = getSupabase();
    if (!supabase) {
      set({ projects: SEED, loading: false, loaded: true });
      return;
    }

    set({ loading: true });
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      set({ projects: [], loading: false, loaded: true });
      return;
    }

    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      set({ loading: false, loaded: true });
      return;
    }

    set({
      projects: (data as ProjectRow[]).map(rowToProject),
      loading: false,
      loaded: true,
    });
  },

  togglePin: async (id) => {
    const current = get().projects.find((p) => p.id === id);
    if (!current) return;
    const pinned = !current.pinned;

    // Optimistic update.
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, pinned } : p)),
    }));

    const supabase = getSupabase();
    if (isSupabaseConfigured() && supabase) {
      const { error } = await supabase
        .from("projects")
        .update({ pinned })
        .eq("id", id);
      if (error) {
        // Roll back on failure.
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, pinned: current.pinned } : p,
          ),
        }));
      }
    }
  },

  createProject: async ({ name, description, type, status = "active" }) => {
    const trimmedName = name.trim() || "Untitled project";
    const desc = description.trim();

    if (isSupabaseConfigured()) {
      const supabase = getSupabase();
      if (!supabase) return null;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from("projects")
        .insert({
          user_id: user.id,
          name: trimmedName,
          description: desc,
          type,
          status,
        })
        .select("*")
        .single();

      if (error || !data) return null;
      const project = rowToProject(data as ProjectRow);
      set((s) => ({ projects: [project, ...s.projects] }));
      return project;
    }

    // Demo mode — in-memory only.
    const now = new Date().toISOString();
    const project: Project = {
      id: uid("proj"),
      name: trimmedName,
      description: desc,
      type,
      status,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ projects: [project, ...s.projects] }));
    return project;
  },

  updateProject: async (id, patch) => {
    const previous = get().projects;
    const now = new Date().toISOString();
    // Optimistic update.
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: now } : p)),
    }));

    const supabase = getSupabase();
    if (isSupabaseConfigured() && supabase) {
      const { error } = await supabase
        .from("projects")
        .update({ ...patch, updated_at: now })
        .eq("id", id);
      if (error) set({ projects: previous }); // roll back on failure
    }
  },

  deleteProject: async (id) => {
    const previous = get().projects;
    // Optimistic removal.
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));

    const supabase = getSupabase();
    if (isSupabaseConfigured() && supabase) {
      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) set({ projects: previous });
    }
  },
}));
