"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandK } from "./command-k";
import { cn } from "@/lib/utils";

interface AdminShellProps {
  children: React.ReactNode;
  title?: string;
}

export function AdminShell({ children, title = "Dashboard" }: AdminShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [usdRateCup, setUsdRateCup] = useState<number | null>(null);

  // Tema: token-driven, persistido (claro/oscuro).
  useEffect(() => {
    try {
      const raw = localStorage.getItem("tl-theme");
      const next = raw === "dark" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
    } catch {
      document.documentElement.dataset.theme = "light";
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("tl-sidebar-collapsed");
    setSidebarCollapsed(stored === "true");
  }, []);

  useEffect(() => {
    localStorage.setItem("tl-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  // Load exchange rate once (and refresh on tl-refresh if missing)
  useEffect(() => {
    let cancelled = false;
    async function loadRate() {
      try {
        const res = await fetch("/api/admin/exchange-rate", { credentials: "include" });
        if (!res.ok) return;
        const json = (await res.json()) as { usdRateCup?: number };
        const r = Number(json.usdRateCup);
        if (!Number.isFinite(r) || r <= 0) return;
        if (cancelled) return;
        setUsdRateCup(r);
        (globalThis as unknown as { __TL_USD_RATE_CUP__?: number }).__TL_USD_RATE_CUP__ = r;
      } catch {
        // ignore
      }
    }
    void loadRate();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen bg-tl-canvas">
      <CommandK />
      <Sidebar
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
        mobileOpen={mobileSidebarOpen}
        onMobileOpenChange={setMobileSidebarOpen}
      />
      <div
        className={cn(
          "tl-admin-main-column flex min-w-0 flex-1 flex-col transition-all duration-300",
          sidebarCollapsed ? "lg:ml-[72px]" : "lg:ml-[260px]",
        )}
      >
        <Topbar
          title={title}
          onMenuClick={() => setMobileSidebarOpen((prev) => !prev)}
          usdRateCup={usdRateCup}
          onUsdRateCupChange={(next) => {
            setUsdRateCup(next);
            (globalThis as unknown as { __TL_USD_RATE_CUP__?: number }).__TL_USD_RATE_CUP__ = next;
          }}
        />
        <main
          id="admin-main"
          className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
