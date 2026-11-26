import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Globe2, LogOut, Mic, LayoutGrid, ShieldCheck, Crown } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Mes cours", icon: LayoutGrid, test: "nav-courses" },
  { href: "/record", label: "Enregistrer", icon: Mic, test: "nav-record" },
  { href: "/library", label: "Bibliothèque", icon: Globe2, test: "nav-library" },
  { href: "/abonnement", label: "Abonnement", icon: Crown, test: "nav-billing" },
];

export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-black/5">
        <img src="./logo-mark.png" alt="" width={34} height={34} className="h-[34px] w-[34px] object-contain" />
      </span>
      <span className="font-display text-lg font-bold tracking-tight">
        Cours<span className="text-primary">Scribe</span>
      </span>
    </div>
  );
}

function isActive(loc: string, href: string) {
  if (href === "/") return loc === "/" || loc.startsWith("/course");
  if (href === "/library") return loc.startsWith("/library") || loc.startsWith("/public");
  return loc.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const { user, logout } = useAuth();
  const initials = (user?.name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-dvh bg-background">
      {/* Barre latérale (ordinateur) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="px-5 pb-6 pt-6">
          <BrandMark />
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Navigation principale">
          {NAV.map((n) => {
            const active = isActive(loc, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                data-testid={n.test}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <n.icon className="h-[18px] w-[18px]" />
                {n.label}
                {n.href === "/record" && <span className="ml-auto h-2 w-2 rounded-full bg-[#FE277E]" aria-hidden />}
              </Link>
            );
          })}
        </nav>
        <div className="m-3 rounded-xl border border-sidebar-border bg-card p-3">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold" data-testid="text-username">{user?.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <Link
              href="/privacy"
              data-testid="link-privacy"
              className={cn(
                "grid h-8 w-8 place-items-center rounded-lg hover:bg-muted hover:text-foreground",
                loc === "/privacy" ? "text-primary" : "text-muted-foreground",
              )}
              aria-label="Confidentialité"
              title="Confidentialité et données"
            >
              <ShieldCheck className="h-4 w-4" />
            </Link>
            <button
              onClick={logout}
              data-testid="button-logout"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Se déconnecter"
              title="Se déconnecter"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* En-tête mobile */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur lg:hidden">
        <BrandMark />
        <div className="flex items-center gap-1">
          <Link
            href="/privacy"
            className={cn("grid h-9 w-9 place-items-center rounded-lg", loc === "/privacy" ? "text-primary" : "text-muted-foreground")}
            aria-label="Confidentialité et données"
            data-testid="link-privacy-mobile"
          >
            <ShieldCheck className="h-5 w-5" />
          </Link>
          <button onClick={logout} className="px-1 text-sm font-medium text-muted-foreground" data-testid="button-logout-mobile">
            Déconnexion
          </button>
        </div>
      </header>

      <main className="pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-10 lg:pl-64">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</div>
      </main>

      {/* Navigation basse mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Navigation">
        {NAV.map((n) => {
          const active = isActive(loc, n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              data-testid={`${n.test}-mobile`}
              className={cn("flex flex-col items-center gap-1 py-2.5 text-xs font-medium", active ? "text-primary" : "text-muted-foreground")}
            >
              <n.icon className="h-5 w-5" />
              {n.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
