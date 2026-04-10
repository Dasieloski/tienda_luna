import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin · Tienda Luna POS",
  description: "Dashboard y auditoría offline-first",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold tracking-tight text-white">Tienda Luna · Admin</span>
          <a
            href="/"
            className="text-xs text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline"
          >
            Inicio
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
