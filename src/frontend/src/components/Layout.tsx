import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "@tanstack/react-router";
import {
  Activity, AlertTriangle, BrainCircuit, LayoutDashboard, LogOut, Menu,
  Settings, Shield, X, Orbit, Command,
} from "lucide-react";
import { useState } from "react";
import { useAwsAuth } from "../aws/AwsAuth";

const navItems = [
  { to: "/", label: "Overview", icon: LayoutDashboard, ocid: "nav.dashboard.link" },
  { to: "/incidents", label: "Incidents", icon: AlertTriangle, ocid: "nav.incidents.link" },
  { to: "/monitoring", label: "Monitoring", icon: Activity, ocid: "nav.monitoring.link" },
  { to: "/ai-insights", label: "AI Insights", icon: BrainCircuit, ocid: "nav.ai_insights.link" },
  { to: "/settings", label: "Settings", icon: Settings, ocid: "nav.settings.link" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { signOut } = useAwsAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentPage = [...navItems].reverse().find((item) =>
    item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to)
  )?.label ?? "Mission Control";

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="px-5 py-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
            <Shield className="h-5 w-5" />
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,.9)]" />
          </div>
          <div>
            <div className="font-display text-[15px] font-bold tracking-wide text-slate-100">CloudSentinels</div>
            <div className="mt-1 font-mono text-[9px] uppercase tracking-[.22em] text-cyan-200/65">Autonomous defense</div>
          </div>
        </div>
      </div>

      <div className="px-5 pt-6 pb-2 font-mono text-[9px] uppercase tracking-[.2em] text-slate-500">Operations</div>
      <nav className="flex-1 px-3 py-2 space-y-1">
        {navItems.map((item) => {
          const active = item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              data-ocid={item.ocid}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "group flex items-center gap-3 rounded-lg border px-3 py-3 text-[13px] font-medium transition-all duration-200",
                active
                  ? "border-cyan-300/20 bg-cyan-300/[.09] text-cyan-100 shadow-[inset_2px_0_0_rgba(103,232,249,.85),0_8px_24px_rgba(0,0,0,.12)]"
                  : "border-transparent text-slate-400 hover:border-slate-700/70 hover:bg-white/[.035] hover:text-slate-100",
              )}
            >
              <item.icon className={cn("h-4 w-4 shrink-0", active ? "text-cyan-200" : "text-slate-500 group-hover:text-cyan-200")} />
              {item.label}
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,.9)]" />}
            </Link>
          );
        })}
      </nav>

      <div className="mx-4 mb-4 rounded-xl border border-cyan-300/10 bg-cyan-300/[.035] p-3">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-cyan-100/70">
          <Orbit className="h-3.5 w-3.5" /> Mission profile
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">AI-powered self-healing for Kubernetes and live cluster systems.</p>
      </div>
      <div className="border-t border-sidebar-border px-3 py-4">
        <Button variant="ghost" size="sm" data-ocid="auth.logout.button" onClick={() => void signOut()} className="w-full justify-start gap-3 text-slate-400 hover:bg-red-400/10 hover:text-red-300">
          <LogOut className="h-4 w-4" /> Sign Out
        </Button>
      </div>
    </div>
  );

  return (
    <div className="mission-app flex h-screen overflow-hidden">
      <aside className="mission-sidebar hidden w-64 shrink-0 flex-col border-r md:flex">
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 h-full w-full cursor-default bg-black/70" onClick={() => setMobileOpen(false)} />
          <aside className="mission-sidebar relative h-full w-72 border-r">
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="mission-topbar shrink-0">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" className="md:hidden -ml-2 text-slate-300" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle navigation">
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <div className="hidden items-center gap-2 text-cyan-200/70 md:flex"><Command className="h-4 w-4" /><span className="mission-topbar-kicker">CloudSentinels / Mission control</span></div>
            <div className="md:hidden mission-topbar-title">{currentPage}</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="mission-topbar-kicker">Environment</div>
              <div className="mission-topbar-title">AWS-native control plane</div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-cyan-200/20 bg-cyan-200/[.07] text-cyan-100"><Orbit className="h-4 w-4" /></div>
          </div>
        </header>
        <main className="mission-content flex-1 overflow-y-auto">
          <div className="relative z-10 min-h-full">{children}</div>
        </main>
      </div>
      <Toaster />
    </div>
  );
}
