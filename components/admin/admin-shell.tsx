"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

interface AdminShellProps {
  children: React.ReactNode;
  title?: string;
}

export function AdminShell({ children, title = "Dashboard" }: AdminShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    function checkCollapsed() {
      const stored = localStorage.getItem("tl-sidebar-collapsed");
      setSidebarCollapsed(stored === "true");
    }
    checkCollapsed();
    const interval = setInterval(checkCollapsed, 100);
    return () => clearInterval(interval);
  }, []);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      window.dispatchEvent(new CustomEvent("tl-refresh"));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex min-h-screen bg-tl-canvas">
      <Sidebar />
      <div
        className="flex flex-1 flex-col transition-all duration-300"
        style={{ marginLeft: sidebarCollapsed ? 72 : 260 }}
      >
        <Topbar title={title} />
        <main
          id="admin-main"
          className="flex-1 overflow-y-auto p-6"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
