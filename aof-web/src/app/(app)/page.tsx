import { WelcomeHero } from "@/components/home/welcome-hero";
import { HomePrompt } from "@/components/home/home-prompt";
import { QuickActions } from "@/components/home/quick-actions";

export default function HomePage() {
  return (
    <div className="relative min-h-full">
      {/* faint grid behind the hero */}
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-x-0 top-0 h-[420px]" />

      <div className="relative mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-10 sm:px-6 sm:py-16">
        <WelcomeHero />

        <div className="mt-9">
          <HomePrompt />
        </div>

        <div className="mt-10 sm:mt-14">
          <p className="mb-3 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
            Quick actions
          </p>
          <QuickActions />
        </div>
      </div>
    </div>
  );
}
