"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy, Share2, Twitter, Linkedin } from "lucide-react";
import { cn } from "@/lib/utils";

interface SocialShareProps {
  url?: string;
  title?: string;
  description?: string;
  className?: string;
}

export function SocialShare({
  url = typeof window !== "undefined" ? window.location.href : "https://coagentix.app",
  title = "Coagentix — The professional AI platform",
  description = "Many Minds. One Intelligence. Chat, code, and build with a fleet of AI agents.",
  className,
}: SocialShareProps) {
  const [copied, setCopied] = useState(false);

  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  const encodedDesc = encodeURIComponent(description);

  const SHARE_LINKS = [
    {
      label: "Twitter / X",
      icon: Twitter,
      href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
    },
    {
      label: "LinkedIn",
      icon: Linkedin,
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}&summary=${encodedDesc}`,
    },
  ];

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silently fail
    }
  }

  async function nativeShare() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      await navigator.share({ title, text: description, url }).catch(() => {});
    }
  }

  const hasNativeShare = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {hasNativeShare && (
        <Button variant="outline" size="sm" onClick={nativeShare}>
          <Share2 className="size-3.5 mr-1.5" />
          Share
        </Button>
      )}

      {SHARE_LINKS.map(({ label, icon: Icon, href }) => (
        <Button
          key={label}
          variant="outline"
          size="sm"
          asChild
        >
          <a href={href} target="_blank" rel="noopener noreferrer">
            <Icon className="size-3.5 mr-1.5" />
            {label}
          </a>
        </Button>
      ))}

      <Button variant="outline" size="sm" onClick={copyLink}>
        {copied ? (
          <><Check className="size-3.5 mr-1.5 text-emerald-400" />Copied!</>
        ) : (
          <><Copy className="size-3.5 mr-1.5" />Copy link</>
        )}
      </Button>
    </div>
  );
}

// ── Referral Share Panel ──────────────────────────────────────────────────────

interface ReferralShareProps {
  referralCode: string;
  className?: string;
}

export function ReferralShare({ referralCode, className }: ReferralShareProps) {
  const referralUrl = `https://coagentix.app/?ref=${referralCode}`;
  const shareText = `Try Coagentix — the professional AI platform with many minds and one intelligence. Sign up with my link:`;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-4 py-2.5 font-mono text-sm">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{referralUrl}</span>
      </div>
      <SocialShare
        url={referralUrl}
        title={shareText}
        description={shareText}
      />
    </div>
  );
}
