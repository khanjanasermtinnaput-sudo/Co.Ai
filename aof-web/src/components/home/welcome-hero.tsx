"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { BRAND } from "@/lib/constants";

export function WelcomeHero() {
  return (
    <div className="flex flex-col items-center text-center">
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary"
      >
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
        </span>
        Your AI workspace is ready
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
        className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl"
      >
        <span className="mb-1 mr-1 inline-block animate-float [will-change:transform]">
          <Sparkles className="inline size-7 text-primary sm:size-8" />
        </span>
        <span className="text-gradient-gold">{BRAND.welcome}</span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
        className="mt-4 max-w-md text-balance text-base text-muted-foreground sm:text-lg"
      >
        {BRAND.welcomeSub}
      </motion.p>

      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="mt-2 max-w-lg text-balance text-sm text-muted-foreground/70"
      >
        {BRAND.description}
      </motion.p>

      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="mt-4 max-w-lg text-balance text-xs text-muted-foreground/50"
      >
        {BRAND.about}
      </motion.p>
    </div>
  );
}
