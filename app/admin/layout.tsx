import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin · Tienda Luna POS",
  description: "Dashboard y auditoría offline-first",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="tl-admin-root min-h-screen bg-tl-canvas text-tl-ink">
      {/* Skip link */}
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-tl-accent focus:px-4 focus:py-2 focus:text-white focus:outline-none"
      >
        Saltar al contenido admin
      </a>
      {children}
    </div>
  );
}
