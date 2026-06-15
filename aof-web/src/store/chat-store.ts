import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/utils";
import { streamChat, type ChatHistoryItem } from "@/lib/api";
import { routeRequest } from "@/lib/router";
import { composeLearningReply, isLearningProblem } from "@/lib/mock";
import {
  conversationsEnabled,
  createConversation,
  deleteConversationRemote,
  fetchConversations,
  renameConversation,
  saveMessages,
} from "@/lib/conversations";
import type {
  Attachment,
  ChatMessageT,
  ChatModel,
  Conversation,
  ResponseStyle,
} from "@/lib/types";

interface PendingMessage {
  text: string;
  attachments?: Attachment[];
}

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  style: ResponseStyle;
  streaming: boolean;
  pendingFirstMessage: PendingMessage | null;
  abort: AbortController | null;

  setStyle: (s: ResponseStyle) => void;
  newConversation: () => string;
  selectConversation: (id: string | null) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  loadRemoteConversations: () => Promise<void>;
  queueFirstMessage: (text: string, attachments?: Attachment[]) => void;
  consumePending: () => PendingMessage | null;
  send: (text: string, attachments?: Attachment[]) => Promise<void>;
  regenerate: () => Promise<void>;
  stop: () => void;
}

function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 42 ? `${t.slice(0, 42)}…` : t || "New chat";
}

function modelForStyle(style: ResponseStyle): ChatModel {
  return style === "short" ? "lite" : "normal";
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,
      style: "normal",
      streaming: false,
      pendingFirstMessage: null,
      abort: null,

      setStyle: (style) => set({ style }),

      newConversation: () => {
        const id = uid("conv");
        const now = new Date().toISOString();
        const conv: Conversation = {
          id,
          title: "New chat",
          model: modelForStyle(get().style),
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ conversations: [conv, ...s.conversations], activeId: id }));
        if (conversationsEnabled()) {
          createConversation(conv).catch(() => {});
        }
        return id;
      },

      selectConversation: (id) => set({ activeId: id }),

      deleteConversation: (id) => {
        set((s) => {
          const remaining = s.conversations.filter((c) => c.id !== id);
          const nextActive =
            s.activeId === id
              ? (remaining[0]?.id ?? null)
              : s.activeId;
          return { conversations: remaining, activeId: nextActive };
        });
        if (conversationsEnabled()) {
          deleteConversationRemote(id).catch(() => {});
        }
      },

      renameConversation: (id, title) => {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, title } : c,
          ),
        }));
        if (conversationsEnabled()) {
          renameConversation(id, title).catch(() => {});
        }
      },

      loadRemoteConversations: async () => {
        if (!conversationsEnabled()) return;
        try {
          const remote = await fetchConversations();
          if (!remote.length) return;
          set((s) => {
            const localIds = new Set(s.conversations.map((c) => c.id));
            const toAdd: Conversation[] = remote
              .filter((r) => !localIds.has(r.id))
              .map((r) => ({
                id: r.id,
                title: r.title,
                model: (r.model as ChatModel) ?? "normal",
                messages: [],
                createdAt: r.created_at,
                updatedAt: r.updated_at,
              }));
            if (!toAdd.length) return s;
            const merged = [...s.conversations, ...toAdd].sort(
              (a, b) =>
                new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
            );
            return { conversations: merged };
          });
        } catch {
          // network failure — keep working with local state
        }
      },

      queueFirstMessage: (text, attachments) =>
        set({ pendingFirstMessage: { text, attachments } }),
      consumePending: () => {
        const p = get().pendingFirstMessage;
        if (p) set({ pendingFirstMessage: null });
        return p;
      },

      send: async (text, attachments) => {
        const content = text.trim();
        if ((!content && !(attachments && attachments.length)) || get().streaming) return;

        let activeId = get().activeId;
        if (!activeId) activeId = get().newConversation();

        const style = get().style;
        const route = routeRequest(content, attachments ?? []);
        const now = new Date().toISOString();

        const userMsg: ChatMessageT = {
          id: uid("m"),
          role: "user",
          content,
          createdAt: now,
          attachments: attachments && attachments.length ? attachments : undefined,
        };
        const assistantId = uid("m");
        const assistantMsg: ChatMessageT = {
          id: assistantId,
          role: "assistant",
          content: "",
          createdAt: now,
          streaming: true,
          model: modelForStyle(style),
          route,
          style,
        };

        const isFirstMessage =
          (get().conversations.find((c) => c.id === activeId)?.messages.length ?? 0) === 0;
        const autoTitle = isFirstMessage ? titleFrom(content || route.label) : null;

        set((s) => ({
          streaming: true,
          conversations: s.conversations.map((c) =>
            c.id === activeId
              ? {
                  ...c,
                  title: autoTitle ?? c.title,
                  messages: [...c.messages, userMsg, assistantMsg],
                  updatedAt: now,
                }
              : c,
          ),
        }));

        if (conversationsEnabled() && autoTitle) {
          renameConversation(activeId, autoTitle).catch(() => {});
        }

        const finish = (finalContent?: string) =>
          set((s) => ({
            streaming: false,
            abort: null,
            conversations: s.conversations.map((c) => {
              if (c.id !== activeId) return c;
              const updatedAt = new Date().toISOString();
              const messages = c.messages.map((m) =>
                m.id === assistantId
                  ? { ...m, streaming: false, content: finalContent ?? m.content }
                  : m,
              );
              if (conversationsEnabled()) {
                const toSave = messages.filter(
                  (m) => m.id === userMsg.id || m.id === assistantId,
                );
                saveMessages(activeId, toSave).catch(() => {});
              }
              return { ...c, messages, updatedAt };
            }),
          }));

        // ── Math & Learning mode ──────────────────────────────────────────────
        if (route.target === "chat" && isLearningProblem(content)) {
          const controller = new AbortController();
          set({ abort: controller });
          await new Promise((r) => setTimeout(r, 500));
          if (!controller.signal.aborted) {
            const learning = composeLearningReply(content);
            set((s) => ({
              conversations: s.conversations.map((c) =>
                c.id === activeId
                  ? {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === assistantId ? { ...m, learning } : m,
                      ),
                    }
                  : c,
              ),
            }));
          }
          finish();
          return;
        }

        const history: ChatHistoryItem[] = (
          get().conversations.find((c) => c.id === activeId)?.messages ?? []
        )
          .filter((m) => m.role !== "system" && m.id !== assistantId)
          .slice(-40)
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

        const controller = new AbortController();
        set({ abort: controller });

        const patchAssistant = (patch: Partial<ChatMessageT>) =>
          set((s) => ({
            conversations: s.conversations.map((c) =>
              c.id === activeId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantId ? { ...m, ...patch } : m,
                    ),
                  }
                : c,
            ),
          }));

        let accumulated = "";
        const appendToken = (chunk: string) => {
          accumulated += chunk;
          set((s) => ({
            conversations: s.conversations.map((c) =>
              c.id === activeId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantId ? { ...m, content: m.content + chunk } : m,
                    ),
                  }
                : c,
            ),
          }));
        };

        try {
          await streamChat(
            content,
            { style, route, history },
            {
              onToken: appendToken,
              signal: controller.signal,
              onError: (error) => patchAssistant({ error, streaming: false }),
              onFailover: (failover) => patchAssistant({ failover }),
            },
          );
        } finally {
          finish(accumulated || undefined);
        }
      },

      regenerate: async () => {
        const { conversations, activeId, streaming } = get();
        if (streaming || !activeId) return;

        const conv = conversations.find((c) => c.id === activeId);
        if (!conv) return;

        // Find the last user message and remove everything after it
        const lastUserIdx = [...conv.messages].reverse().findIndex((m) => m.role === "user");
        if (lastUserIdx === -1) return;

        const cutIdx = conv.messages.length - 1 - lastUserIdx;
        const lastUserMsg = conv.messages[cutIdx];
        const keptMessages = conv.messages.slice(0, cutIdx);

        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === activeId ? { ...c, messages: keptMessages } : c,
          ),
        }));

        await get().send(lastUserMsg.content, lastUserMsg.attachments);
      },

      stop: () => {
        get().abort?.abort();
        set({ abort: null, streaming: false });
      },
    }),
    {
      name: "aof.chat",
      partialize: (s) => ({
        style: s.style,
        conversations: s.conversations.map((c) => ({
          ...c,
          // Truncate messages in localStorage — only keep last 20 per conversation
          messages: c.messages.slice(-20),
        })),
        activeId: s.activeId,
      }),
    },
  ),
);
