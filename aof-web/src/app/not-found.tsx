import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { AmbientBackground } from "@/components/layout/ambient-background";

export default function NotFound() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <AmbientBackground />
      <Logo size={40} />
      <p className="mt-8 text-7xl font-semibold tracking-tight text-gradient-gold">404</p>
      <h1 className="mt-2 text-xl font-semibold">This page wandered off</h1>
      <p className="mt-2 max-w-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist. Let&apos;s get you back to your
        workspace.
      </p>
      <Button asChild className="mt-6">
        <Link href="/">Back to Co.AI</Link>
      </Button>
    </div>
  );
}
