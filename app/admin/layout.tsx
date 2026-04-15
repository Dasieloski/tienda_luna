import type { Metadata } from "next";
import Link from "next/link";
import { Home, LogIn, Moon, Sparkles } from "lucide-react";

export const metadata: Metadata = {
  title: "Admin · Tienda Luna POS",
  description: "Dashboard y auditoría offline-first",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-[#070708] text-zinc-100">
      <div
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_120%_80%_at_50%_-30%,rgba(139,92,246,0.22),transparent_55%),radial-gradient(ellipse_80%_50%_at_100%_0%,rgba(217,70,239,0.12),transparent_50%)]"
        aria-hidden
      />
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-xl focus:bg-violet-500 focus:px-4 focus:py-2 focus:text-white focus:outline-none focus:ring-2 focus:ring-violet-300"
      >
        Saltar al contenido admin
      </a>
      <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-zinc-950/75 backdrop-blur-2xl">
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-violet-500/50 to-transparent" />
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <Link href="/admin" className="group flex min-w-0 items-center gap-3 rounded-xl p-1 transition-colors hover:bg-white/5">
            <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-900/50 ring-2 ring-white/10">
              <Moon className="h-5 w-5 text-white" aria-hidden />
              <span className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
            </span>
            <div className="min-w-0 text-left">
              <p className="flex items-center gap-1.5 truncate text-sm font-bold tracking-tight text-white">
                Tienda Luna
                <Sparkles className="h-3.5 w-3.5 text-amber-300/90 opacity-80 motion-safe:group-hover:animate-pulse" aria-hidden />
              </p>
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/80">
                Command center
              </p>
            </div>
          </Link>

          <nav
            aria-label="Accesos"
            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] p-1 ring-1 ring-white/5"
          >
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-zinc-400 transition-all hover:bg-white/10 hover:text-white sm:px-4 sm:text-sm"
            >
              <Home className="h-4 w-4 text-violet-400/90" aria-hidden />
              <span className="hidden sm:inline">Sitio</span>
            </Link>
            <Link
              href="/admin/login"
              className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-zinc-400 transition-all hover:bg-white/10 hover:text-white sm:px-4 sm:text-sm"
            >
              <LogIn className="h-4 w-4 text-fuchsia-400/90" aria-hidden />
              <span className="hidden sm:inline">Sesión</span>
            </Link>
          </nav>
        </div>
      </header>
      <main id="admin-main" className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
