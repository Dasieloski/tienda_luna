"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { cn } from "@/lib/utils";

interface AdminShellProps {
  children: React.ReactNode;
  title?: string;
}

export function AdminShell({ children, title = "Dashboard" }: AdminShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("tl-sidebar-collapsed");
    setSidebarCollapsed(stored === "true");
  }, []);

  useEffect(() => {
    localStorage.setItem("tl-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      window.dispatchEvent(new CustomEvent("tl-refresh"));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex min-h-screen bg-tl-canvas">
      <Sidebar
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
        mobileOpen={mobileSidebarOpen}
        onMobileOpenChange={setMobileSidebarOpen}
      />
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-all duration-300",
          sidebarCollapsed ? "lg:ml-[72px]" : "lg:ml-[260px]",
        )}
      >
        <Topbar
          title={title}
          onMenuClick={() => setMobileSidebarOpen((prev) => !prev)}
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
