import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
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
  EffortLevel,
} from "@/lib/types";
import { clampEffort } from "@/lib/effort";
import { checkUserAccess } from "@/lib/access";
import { useAuthStore } from "@/store/auth-store";
import { useGuestStore } from "@/store/guest-store";
import { useUsageStore, estimateTokensFor } from "@/store/usage-store";

interface PendingMessage {
  text: string;
  attachments?: Attachment[];
}

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  /** Manually-selected CoChat model: "lite" = Mikros, "normal" = Kanon. */
  model: ChatModel;
  /** Reasoning-effort dial for the selected model (Low/Normal/High). */
  effort: EffortLevel;
  streaming: boolean;
  pendingFirstMessage: PendingMessage | null;
  abort: AbortController | null;

  setModel: (m: ChatModel) => void;
  setEffort: (e: EffortLevel) => void;
  newConversation: () => string;
  selectConversation: (id: string | null) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  loadRemoteConversations: () => Promise<void>;
  migrateGuestConversations: () => Promise<void>;
  queueFirstMessage: (text: string, attachments?: Attachment[]) => void;
  consumePending: () => PendingMessage | null;
  /**
   * Dispatch a message. Resolves `true` once the message has been committed to the
   * conversation (the composer may then clear its draft), or `false` when the send
   * was rejected up-front (empty, already streaming, or blocked by the access gate)
   * — in which case the caller must preserve the user's unsent text.
   */
  send: (text: string, attachments?: Attachment[]) => Promise<boolean>;
  editMessage: (messageId: string, newContent: string) => Promise<void>;
  regenerate: () => Promise<void>;
  stop: () => void;
}

function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 42 ? `${t.slice(0, 42)}…` : t || "New chat";
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,
      // Kanon is the balanced default (the "Default"-badged model in CHAT_MODELS).
      model: "normal",
      effort: "normal",
      streaming: false,
      pendingFirstMessage: null,
      abort: null,

      // Effort is snapped to the incoming model's scale so a persisted High
      // never survives a switch onto a model that doesn't offer it.
      setModel: (model) => set({ model, effort: clampEffort(model, get().effort) }),
      setEffort: (effort) => set({ effort: clampEffort(get().model, effort) }),

      newConversation: () => {
        const id = uid("conv");
        const now = new Date().toISOString();
        const conv: Conversation = {
          id,
          title: "New chat",
          model: get().model,
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ conversations: [conv, ...s.conversations], activeId: id }));
        if (conversationsEnabled()) {
          createConversation(conv).catch(() => {
            toast.error("Sync failed — chat saved locally", { id: "sync-error", duration: 4000 });
          });
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
          deleteConversationRemote(id).catch(() => {
            toast.error("Sync failed — deleted locally", { id: "sync-error", duration: 4000 });
          });
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

      migrateGuestConversations: async () => {
        // Called right after a guest signs in: upload the chat they started while
        // logged out so it lives on their account, then merge in anything that was
        // already saved server-side. Best-effort — a failed upload keeps the local
        // copy intact.
        if (!conversationsEnabled()) return;
        const localConvos = get().conversations.filter((c) => c.messages.length > 0);
        for (const c of localConvos) {
          try {
            await createConversation({ id: c.id, title: c.title, model: c.model });
            await saveMessages(c.id, c.messages);
          } catch {
            /* keep local copy; will retry on next save */
          }
        }
        if (localConvos.length) {
          toast.success("Your chat was saved to your account", { id: "guest-migrated", duration: 4000 });
        }
        await get().loadRemoteConversations();
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
        if ((!content && !(attachments && attachments.length)) || get().streaming) return false;

        // ── Access gate ──────────────────────────────────────────────────────
        // Guests can chat up to the limit; past it we surface the login wall and
        // stop here so the message is never lost (the composer keeps its draft).
        const access = checkUserAccess("send-message");
        if (!access.allowed) {
          if (access.requiresUpgrade) {
            toast.error(access.reason ?? "Upgrade required", {
              description: "Open Settings → Billing to upgrade your plan.",
              duration: 5000,
            });
          } else {
            useAuthStore.getState().openLoginModal(access.reason);
          }
          return false;
        }
        if (useAuthStore.getState().tier === "GUEST") {
          useGuestStore.getState().increment();
        }
        useUsageStore.getState().recordMessage(estimateTokensFor(content));

        let activeId = get().activeId;
        if (!activeId) activeId = get().newConversation();

        const model = get().model;
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
          model,
          route,
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
                saveMessages(activeId, toSave).catch(() => {
                  toast.error("Sync failed — messages saved locally", { id: "sync-error", duration: 4000 });
                });
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
          return true;
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
          // CoChat = fast single-pass assistant. One provider call to /api/chat with
          // the user's chosen model (Mikros/Kanon). No orchestration, no TMAP, no
          // multi-agent — that pipeline lives in CoCode only. Memory/persistence runs
          // asynchronously in finish() after the response, never blocking it.
          await streamChat(
            content,
            { model, route, history },
            {
              onToken: appendToken,
              signal: controller.signal,
              onError: (error) => {
                patchAssistant({ error, streaming: false });
                const description = (error as { message?: string })?.message;
                toast.error("Couldn't send message", {
                  id: "send-error",
                  description,
                  duration: 5000,
                });
              },
              onFailover: (failover) => patchAssistant({ failover }),
              onModel: (activeModel) => patchAssistant({ activeModel }),
              onSources: (sources) => patchAssistant({ sources }),
            },
          );
        } finally {
          finish(accumulated || undefined);
        }
        // Message was committed and the stream completed (success or surfaced
        // error). The draft was already accepted, so report success to the caller.
        return true;
      },

      editMessage: async (messageId, newContent) => {
        const { conversations, activeId, streaming } = get();
        if (streaming || !activeId) return;

        const conv = conversations.find((c) => c.id === activeId);
        if (!conv) return;

        const msgIdx = conv.messages.findIndex((m) => m.id === messageId);
        if (msgIdx === -1 || conv.messages[msgIdx].role !== "user") return;

        // Keep everything up to (but not including) this message
        const keptMessages = conv.messages.slice(0, msgIdx);
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === activeId ? { ...c, messages: keptMessages } : c,
          ),
        }));

        await get().send(newContent, conv.messages[msgIdx].attachments);
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
        model: s.model,
        effort: s.effort,
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
