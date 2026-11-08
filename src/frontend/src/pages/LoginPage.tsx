import { useEffect, useRef } from "react";
import { Activity, BrainCircuit, Shield, Zap } from "lucide-react";
import { useClerkAuth } from "../hooks/useClerkAuth";

export function LoginPage() {
  const signInRef = useRef<HTMLDivElement>(null);
  const { clerk, isLoaded, error } = useClerkAuth();

  useEffect(() => {
    const node = signInRef.current;
    if (!node || !clerk || !isLoaded) return;
    clerk.mountSignIn(node, { routing: "hash" });
    return () => clerk.unmountSignIn(node);
  }, [clerk, isLoaded]);

  return (
    <div className="min-h-screen bg-background grid-bg flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-chart-2/5 rounded-full blur-3xl" />
      </div>
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/15 border border-primary/30 glow-cyan mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="font-display text-3xl font-bold text-foreground text-glow mb-1">CloudSentinels</h1>
          <p className="text-muted-foreground text-sm">AI-Powered DevOps Assistant</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {[
            { icon: Activity, label: "Live Monitoring" },
            { icon: BrainCircuit, label: "AI Analysis" },
            { icon: Zap, label: "Instant Alerts" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card border border-border text-xs text-muted-foreground">
              <Icon className="w-3 h-3 text-primary" />{label}
            </div>
          ))}
        </div>
        <div className="bg-card border border-border rounded-xl p-6 shadow-2xl">
          <h2 className="font-display text-lg font-semibold text-foreground mb-1">Sign in securely</h2>
          <p className="text-sm text-muted-foreground mb-5">Sign in or create your CloudSentinels account with Clerk.</p>
          {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
          <div ref={signInRef} className="min-h-48" />
        </div>
        <p className="text-center text-xs text-muted-foreground mt-6">CloudSentinels · Secure cloud operations and incident response</p>
      </div>
    </div>
  );
}
