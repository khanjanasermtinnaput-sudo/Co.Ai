import { create } from "zustand";
import { uid } from "@/lib/utils";
import { streamChat, type ChatHistoryItem } from "@/lib/api";
import type { ChatMessageT, ChatModel, Conversation } from "@/lib/types";

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  model: ChatModel;
  streaming: boolean;
  /** Message handed off from the welcome composer, consumed by the chat view. */
  pendingFirstMessage: string | null;

  abort: AbortController | null;

  setModel: (m: ChatModel) => void;
  newConversation: () => string;
  selectConversation: (id: string | null) => void;
  queueFirstMessage: (text: string) => void;
  consumePending: () => string | null;
  send: (text: string) => Promise<void>;
  stop: () => void;
}

function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 42 ? `${t.slice(0, 42)}…` : t || "New chat";
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  model: "normal",
  streaming: false,
  pendingFirstMessage: null,
  abort: null,

  setModel: (model) => set({ model }),

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
    return id;
  },

  selectConversation: (id) => set({ activeId: id }),

  queueFirstMessage: (text) => set({ pendingFirstMessage: text }),
  consumePending: () => {
    const p = get().pendingFirstMessage;
    if (p) set({ pendingFirstMessage: null });
    return p;
  },

  send: async (text) => {
    const content = text.trim();
    if (!content || get().streaming) return;

    // Ensure there's an active conversation.
    let activeId = get().activeId;
    if (!activeId) activeId = get().newConversation();

    const now = new Date().toISOString();
    const userMsg: ChatMessageT = {
      id: uid("m"),
      role: "user",
      content,
      createdAt: now,
    };
    const assistantId = uid("m");
    const assistantMsg: ChatMessageT = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: now,
      streaming: true,
      model: get().model,
    };

    set((s) => ({
      streaming: true,
      conversations: s.conversations.map((c) =>
        c.id === activeId
          ? {
              ...c,
              title: c.messages.length === 0 ? titleFrom(content) : c.title,
              messages: [...c.messages, userMsg, assistantMsg],
              updatedAt: now,
            }
          : c,
      ),
    }));

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
      await streamChat(content, get().model, history, {
        onToken: appendToken,
        signal: controller.signal,
      });
    } finally {
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
    }
  },

  stop: () => {
    get().abort?.abort();
    set({ abort: null, streaming: false });
  },
}));
