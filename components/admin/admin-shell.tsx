"use client";

import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

interface AdminShellProps {
  children: React.ReactNode;
}

export function AdminShell({ children }: AdminShellProps) {
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Listen for sidebar collapse changes
  useEffect(() => {
    function checkCollapsed() {
      const stored = localStorage.getItem("tl-sidebar-collapsed");
      setSidebarCollapsed(stored === "true");
    }
    checkCollapsed();
    
    // Check periodically for changes
    const interval = setInterval(checkCollapsed, 100);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsSyncing(true);
    // Dispatch custom event that pages can listen to
    window.dispatchEvent(new CustomEvent("tl-refresh"));
    
    // Simulate sync delay
    await new Promise((r) => setTimeout(r, 600));
    setLastSync(new Date());
    setIsSyncing(false);
  }, []);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setLastSync(new Date());
      window.dispatchEvent(new CustomEvent("tl-refresh"));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Set initial sync time
  useEffect(() => {
    setLastSync(new Date());
  }, []);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div
        className="flex flex-1 flex-col transition-all duration-300"
        style={{ marginLeft: sidebarCollapsed ? 68 : 240 }}
      >
        <Topbar
          lastSync={lastSync}
          onRefresh={handleRefresh}
          isSyncing={isSyncing}
        />
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
