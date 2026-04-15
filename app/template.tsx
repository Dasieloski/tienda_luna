"use client";

import { usePathname } from "next/navigation";

/**
 * Transición entre páginas: al cambiar la ruta, el contenedor se remonta con
 * una animación de entrada (ver `.tl-page-shell` en `globals.css`).
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="tl-page-shell flex min-h-0 w-full flex-1 flex-col">
      {children}
    </div>
  );
}
