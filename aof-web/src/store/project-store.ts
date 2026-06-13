import { create } from "zustand";
import { uid } from "@/lib/utils";
import type { Project, ProjectStatus, ProjectType } from "@/lib/types";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

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
    mode: "normal" as never,
    createdAt: daysAgo(60),
    updatedAt: daysAgo(21),
  },
];

interface ProjectState {
  projects: Project[];
  query: string;
  setQuery: (q: string) => void;
  togglePin: (id: string) => void;
  createProject: (input: {
    name: string;
    description: string;
    type: ProjectType;
    status?: ProjectStatus;
  }) => Project;
  deleteProject: (id: string) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: SEED,
  query: "",
  setQuery: (query) => set({ query }),

  togglePin: (id) =>
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, pinned: !p.pinned } : p)),
    })),

  createProject: ({ name, description, type, status = "active" }) => {
    const now = new Date().toISOString();
    const project: Project = {
      id: uid("proj"),
      name: name.trim() || "Untitled project",
      description: description.trim(),
      type,
      status,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ projects: [project, ...s.projects] }));
    return project;
  },

  deleteProject: (id) =>
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
}));
