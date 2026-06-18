"use client";

import { motion } from "framer-motion";
import { BRAND } from "@/lib/constants";
import { LogoMark } from "@/components/brand/logo";

export function WelcomeHero() {
  return (
    <div className="flex flex-col items-center text-center">

      {/* ── Logo mark ──────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mb-6"
      >
        <LogoMark size={72} />
      </motion.div>

      {/* ── "Live" pill ────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary"
      >
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
        </span>
        Multi-Agent AI · Ready
      </motion.div>

      {/* ── Brand name ─────────────────────────────────────── */}
      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
        className="text-balance text-5xl font-semibold tracking-tight sm:text-6xl"
      >
        <span className="text-gradient-gold">{BRAND.welcome}</span>
      </motion.h1>

      {/* ── Tagline ────────────────────────────────────────── */}
      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="mt-3 text-balance text-lg font-light tracking-wide text-muted-foreground sm:text-xl"
      >
        {BRAND.welcomeSub}
      </motion.p>

      {/* ── Description ────────────────────────────────────── */}
      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="mt-4 max-w-md text-balance text-sm text-muted-foreground/70"
      >
        {BRAND.description}
      </motion.p>

      {/* ── About ──────────────────────────────────────────── */}
      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="mt-3 max-w-lg text-balance text-xs text-muted-foreground/45"
      >
        {BRAND.about}
      </motion.p>

    </div>
  );
}
