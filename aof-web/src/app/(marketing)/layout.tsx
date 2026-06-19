import Link from "next/link";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="mx-auto max-w-5xl flex h-14 items-center justify-between px-6">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Coagentix
          </Link>
          <nav className="flex items-center gap-5 text-sm text-muted-foreground">
            <Link href="/about"   className="hover:text-foreground transition-colors">About</Link>
            <Link href="/blog"    className="hover:text-foreground transition-colors">Blog</Link>
            <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
            <Link href="/login"   className="hover:text-foreground transition-colors font-medium text-foreground">Sign in</Link>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t border-border/50 mt-24 py-12 text-sm text-muted-foreground">
        <div className="mx-auto max-w-5xl px-6 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-medium text-foreground">Coagentix</p>
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/about"   className="hover:text-foreground transition-colors">About</Link>
            <Link href="/blog"    className="hover:text-foreground transition-colors">Blog</Link>
            <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <Link href="/terms"   className="hover:text-foreground transition-colors">Terms of Service</Link>
            <Link href="/cookies" className="hover:text-foreground transition-colors">Cookie Policy</Link>
          </nav>
          <p className="text-xs">© {new Date().getFullYear()} Coagentix. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
