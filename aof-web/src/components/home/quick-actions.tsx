"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { QUICK_ACTIONS } from "@/lib/constants";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.18 } },
};
const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

export function QuickActions() {
  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      {QUICK_ACTIONS.map((action) => (
        <motion.div key={action.key} variants={item}>
          <Link
            href={action.href}
            className={cn(
              "group relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl border border-white/[0.07] bg-card/60 p-4 transition-card",
              "hover:-translate-y-1 hover:border-primary/30 hover:shadow-glow",
            )}
          >
            {/* hover gradient wash */}
            <span
              className={cn(
                "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity duration-300 group-hover:opacity-100",
                action.accent,
              )}
            />
            <div className="relative flex items-start justify-between">
              <span className="flex size-11 items-center justify-center rounded-xl border border-white/10 bg-background/60 text-2xl shadow-sm transition-transform duration-300 group-hover:scale-110">
                {action.emoji}
              </span>
              <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100" />
            </div>
            <div className="relative">
              <h3 className="text-[15px] font-semibold text-foreground">{action.title}</h3>
              <p className="mt-1 text-sm leading-snug text-muted-foreground">
                {action.description}
              </p>
            </div>
          </Link>
        </motion.div>
      ))}
    </motion.div>
  );
}
