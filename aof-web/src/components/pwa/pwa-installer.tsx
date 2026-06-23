"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The `beforeinstallprompt` event isn't in the standard DOM lib types. */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISS_KEY = "aof.pwa.dismissed";
const DISMISS_DAYS = 7;

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at > 0 && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
}

export function PwaInstaller() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  const [installing, setInstalling] = useState(false);

  // Register the service worker (enables installability + offline shell).
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const onLoad = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, []);

  // Capture the install prompt (Chrome/Edge/Android) and decide whether to pop up.
  useEffect(() => {
    if (isStandalone() || dismissedRecently()) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    const onInstalled = () => {
      setShow(false);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // iOS has no beforeinstallprompt — surface a manual "Add to Home Screen" hint.
    let iosTimer: ReturnType<typeof setTimeout> | undefined;
    if (isIos()) {
      iosTimer = setTimeout(() => {
        setIosHint(true);
        setShow(true);
      }, 1200);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, []);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  }

  async function install() {
    if (!deferred) return;
    setInstalling(true);
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* ignore */
    } finally {
      setInstalling(false);
      setDeferred(null);
      setShow(false);
    }
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          role="dialog"
          aria-label="Install Co.AI"
        >
          <div className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-border/70 bg-card/95 p-3 pr-2.5 shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-card/80">
            <Image
              src="/aof-logo.png"
              alt="Co.AI"
              width={44}
              height={44}
              className="size-11 shrink-0 rounded-[22%] object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">ติดตั้งแอป Co.AI</p>
              {iosHint ? (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  แตะ <Share className="inline size-3.5" /> แล้วเลือก “Add to Home Screen”
                </p>
              ) : (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  เปิดเร็วขึ้น เต็มจอ ใช้ได้เหมือนแอปจริง
                </p>
              )}
            </div>

            {!iosHint && (
              <Button size="sm" onClick={install} disabled={installing} className="shrink-0 gap-1.5">
                <Download className="size-4" />
                {installing ? "กำลังติดตั้ง…" : "ดาวน์โหลด"}
              </Button>
            )}

            <button
              type="button"
              onClick={dismiss}
              aria-label="ปิด"
              className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
