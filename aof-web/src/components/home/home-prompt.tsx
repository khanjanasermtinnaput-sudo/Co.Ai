"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useChatStore } from "@/store/chat-store";
import { Composer } from "@/components/composer/composer";
import type { Attachment } from "@/lib/types";
import { BRAND } from "@/lib/constants";

interface HomePromptProps {
  /** Auto-focus the textarea on mount. Disable on mobile to avoid keyboard pop-up. */
  autoFocus?: boolean;
}

export function HomePrompt({ autoFocus = false }: HomePromptProps) {
  const router = useRouter();
  const queueFirstMessage = useChatStore((s) => s.queueFirstMessage);
  const selectConversation = useChatStore((s) => s.selectConversation);

  const startChat = (value: string, attachments: Attachment[] = []) => {
    selectConversation(null);
    queueFirstMessage(value, attachments);
    router.push("/chat");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
      className="w-full"
    >
      <Composer
        size="lg"
        autoFocus={autoFocus}
        placeholder={BRAND.composerPlaceholder}
        onSubmit={startChat}
        className="border-border/50 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.08),0_1px_4px_rgba(0,0,0,0.04)] focus-within:shadow-[0_8px_32px_-4px_rgba(0,0,0,0.12)] dark:shadow-none"
      />
    </motion.div>
  );
}
