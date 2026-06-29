"use client";

import { motion } from "framer-motion";
import { BRAND } from "@/lib/constants";

export function WelcomeHero() {
  return (
    <div className="flex flex-col items-center text-center">
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="text-[32px] font-medium tracking-tight text-foreground"
      >
        {BRAND.welcome}
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
        className="mt-2 text-base text-muted-foreground"
      >
        {BRAND.welcomeSub}
      </motion.p>
    </div>
  );
}
