import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/utils";
import { streamChat, type ChatHistoryItem } from "@/lib/api";
import { routeRequest } from "@/lib/router";
import { composeLearningReply, isLearningProblem } from "@/lib/mock";
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
  /** verbosity the user selected — model choice is automatic. */
  style: ResponseStyle;
  streaming: boolean;
  /** Message handed off from the welcome composer, consumed by the chat view. */
  pendingFirstMessage: PendingMessage | null;

  abort: AbortController | null;

  setStyle: (s: ResponseStyle) => void;
  newConversation: () => string;
  selectConversation: (id: string | null) => void;
  queueFirstMessage: (text: string, attachments?: Attachment[]) => void;
  consumePending: () => PendingMessage | null;
  send: (text: string, attachments?: Attachment[]) => Promise<void>;
  stop: () => void;
}

function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 42 ? `${t.slice(0, 42)}…` : t || "New chat";
}

/** Verbosity maps to the underlying model: short → Lite, otherwise Normal. */
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
        return id;
      },

      selectConversation: (id) => set({ activeId: id }),

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

        // Ensure there's an active conversation.
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

        set((s) => ({
          streaming: true,
          conversations: s.conversations.map((c) =>
            c.id === activeId
              ? {
                  ...c,
                  title: c.messages.length === 0 ? titleFrom(content || route.label) : c.title,
                  messages: [...c.messages, userMsg, assistantMsg],
                  updatedAt: now,
                }
              : c,
          ),
        }));

        const finish = () =>
          set((s) => ({
            streaming: false,
            abort: null,
            conversations: s.conversations.map((c) =>
              c.id === activeId
                ? {
                    ...c,
                    updatedAt: new Date().toISOString(),
                    messages: c.messages.map((m) =>
                      m.id === assistantId ? { ...m, streaming: false } : m,
                    ),
                  }
                : c,
            ),
          }));

        // ── Math & Learning mode — structured answer, toggled inline. ──────────
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
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

        const controller = new AbortController();
        set({ abort: controller });

        const appendToken = (chunk: string) =>
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

        try {
          await streamChat(
            content,
            { style, route, history },
            { onToken: appendToken, signal: controller.signal },
          );
        } finally {
          finish();
        }
      },

      stop: () => {
        get().abort?.abort();
        set({ abort: null, streaming: false });
      },
    }),
    {
      name: "aof.chat",
      partialize: (s) => ({ style: s.style }),
    },
  ),
);
