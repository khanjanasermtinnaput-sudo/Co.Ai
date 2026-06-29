"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { MessageSquare, Code2 } from "lucide-react";

const COMPACT_ACTIONS = [
  {
    key: "chat",
    title: "Co.AI",
    description: "General Assistant",
    href: "/chat",
    icon: MessageSquare,
  },
  {
    key: "code",
    title: "CoCode",
    description: "Build Apps",
    href: "/code",
    icon: Code2,
  },
];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.15 } },
};
const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
};

export function QuickActions() {
  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="grid w-full grid-cols-2 gap-5"
    >
      {COMPACT_ACTIONS.map((action) => (
        <motion.div key={action.key} variants={item}>
          <Link
            href={action.href}
            className="group flex h-[88px] items-center gap-3 rounded-2xl border border-border bg-card px-4 transition-all hover:border-primary/30 hover:shadow-sm"
            aria-label={action.title}
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-colors group-hover:text-foreground">
              <action.icon className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-medium text-foreground">{action.title}</p>
              <p className="text-[13px] text-muted-foreground">{action.description}</p>
            </div>
          </Link>
        </motion.div>
      ))}
    </motion.div>
  );
}
