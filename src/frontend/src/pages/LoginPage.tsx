import { Button } from "@/components/ui/button";
import { Activity, BrainCircuit, Shield, Zap } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useFirebaseAuth } from "../auth/FirebaseAuth";

export function LoginPage({ authError }: { authError?: string | null }) {
  const { signIn, signInEmail, signUpEmail, error, isLoaded } =
    useFirebaseAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [formError, setFormError] = useState<string | null>(null);
  const message = formError || authError || error;

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      if (mode === "signup") await signUpEmail(email.trim(), password);
      else await signInEmail(email.trim(), password);
    } catch (reason) {
      setFormError(
        reason instanceof Error ? reason.message : "Firebase sign-in failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-login min-h-screen bg-background grid-bg flex items-center justify-center p-4">
      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/15 border border-primary/30 glow-cyan mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="font-display text-3xl font-700 text-foreground text-glow mb-1">
            CloudSentinels
          </h1>
          <p className="text-muted-foreground text-sm">
            AI-powered operations for connected Kubernetes clusters
          </p>
        </div>
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
        <div className="bg-card border border-border rounded-xl p-6 shadow-2xl">
          <h2 className="font-display text-lg font-600 text-foreground mb-1">
            Sign in securely
          </h2>
          <p className="text-sm text-muted-foreground mb-5">
            Your account is secured by Google Firebase Authentication.
          </p>
          {message && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <p className="font-semibold">
                Authentication could not be completed
              </p>
              <p className="mt-1 break-words">{message}</p>
            </div>
          )}
          <Button
            className="w-full"
            onClick={() => void signIn()}
            disabled={!isLoaded || busy}
          >
            <span className="flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Continue with Google
            </span>
          </Button>
          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            OR EMAIL
            <span className="h-px flex-1 bg-border" />
          </div>
          <form
            onSubmit={(event) => void submitEmail(event)}
            className="space-y-3"
          >
            <label className="block text-xs text-muted-foreground">
              Email address
              <input
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Password
              <input
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                type="password"
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                minLength={6}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <Button
              className="w-full"
              type="submit"
              variant="secondary"
              disabled={!isLoaded || busy}
            >
              {busy
                ? "Please waitâ€¦"
                : mode === "signup"
                  ? "Create account"
                  : "Sign in with email"}
            </Button>
          </form>
          <button
            type="button"
            className="mt-3 w-full text-xs text-primary hover:underline"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setFormError(null);
            }}
          >
            {mode === "signin"
              ? "New here? Create an account"
              : "Already have an account? Sign in"}
          </button>
          <p className="mt-4 text-xs text-muted-foreground text-center">
            Firebase ID tokens are verified by the CloudSentinels Go API.
          </p>
        </div>
        <p className="text-center text-xs text-muted-foreground mt-6">
          CloudSentinels Â· Cloud operations and incident response
        </p>
      </div>
    </div>
  );
}
