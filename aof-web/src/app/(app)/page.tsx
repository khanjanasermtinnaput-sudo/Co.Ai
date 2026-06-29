import dynamic from "next/dynamic";
import { WelcomeHero } from "@/components/home/welcome-hero";
import { HomePrompt } from "@/components/home/home-prompt";
import { QuickActions } from "@/components/home/quick-actions";

const ExamplesSection = dynamic(
  () => import("@/components/home/examples-section").then((m) => m.ExamplesSection),
  { ssr: false, loading: () => null },
);

export default function HomePage() {
  return (
    /*
     * Outer: fills the scrollable <main>. Mobile uses flex-col so the sticky
     * input (shrink-0) is always anchored to the bottom of the visible area.
     * Desktop centres content vertically with justify-center.
     */
    <div className="flex min-h-full flex-col bg-[#FAFAFA] dark:bg-background">

      {/* ── Scrollable content ─────────────────────────────────────────────── */}
      {/*
       * pb-28 on mobile: reserves space at the bottom so the sticky input
       * doesn't overlap the last content item when scrolling.
       * sm:justify-center: vertically centres the content block on desktop.
       */}
      <div className="flex flex-1 flex-col items-center px-6 pb-28 pt-16 sm:justify-center sm:pb-20 sm:py-20">
        <div className="w-full max-w-2xl">

          {/* Hero */}
          <WelcomeHero />

          {/* Input — inline on desktop only; autofocus here since keyboard won't obscure content */}
          <div className="mt-8 hidden sm:block">
            <HomePrompt autoFocus />
          </div>

          {/* Quick-action cards */}
          <div className="mt-6 sm:mt-5">
            <QuickActions />
          </div>

          {/* Examples — lazy-loaded below the fold */}
          <ExamplesSection />

        </div>
      </div>

      {/* ── Mobile sticky input ─────────────────────────────────────────────── */}
      {/*
       * sticky bottom-0: follows the scroll viewport of <main> so it's always
       * visible at the bottom on mobile regardless of content height.
       * sm:hidden: desktop shows the inline input above instead.
       */}
      <div className="sticky bottom-0 z-10 shrink-0 border-t border-border/30 bg-[#FAFAFA]/95 px-4 pb-6 pt-3 backdrop-blur-xl dark:bg-background/95 sm:hidden">
        <HomePrompt />
      </div>

    </div>
  );
}
