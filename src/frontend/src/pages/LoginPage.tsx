import { Button } from "@/components/ui/button";
import { Activity, BrainCircuit, Shield, Zap } from "lucide-react";
import { useInternetIdentity } from "../hooks/useInternetIdentity";

export function LoginPage() {
  const { login, isLoggingIn } = useInternetIdentity();

  return (
    <div className="min-h-screen bg-background grid-bg flex items-center justify-center p-4">
      {/* Ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-chart-2/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo & title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/15 border border-primary/30 glow-cyan mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="font-display text-3xl font-700 text-foreground text-glow mb-1">
            CloudSentinels
          </h1>
          <p className="text-muted-foreground text-sm">
            AI-Powered DevOps Assistant
          </p>
        </div>

        {/* Feature pills */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {[
            { icon: Activity, label: "Live Monitoring" },
            { icon: BrainCircuit, label: "AI Analysis" },
            { icon: Zap, label: "Instant Alerts" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card border border-border text-xs text-muted-foreground"
            >
              <Icon className="w-3 h-3 text-primary" />
              {label}
            </div>
          ))}
        </div>

        {/* Login card */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-2xl">
          <h2 className="font-display text-lg font-600 text-foreground mb-1">
            Sign in securely
          </h2>
          <p className="text-sm text-muted-foreground mb-5">
            Use Internet Identity to access your incident and monitoring workspace.
          </p>
          <Button
            className="w-full bg-primary/90 hover:bg-primary text-primary-foreground font-semibold"
            onClick={login}
            disabled={isLoggingIn}
            data-ocid="auth.login.button"
          >
            {isLoggingIn ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Authenticating...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Sign in with Internet Identity
              </span>
            )}
          </Button>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          CloudSentinels · Cloud operations and incident response
        </p>
      </div>
    </div>
  );
}
