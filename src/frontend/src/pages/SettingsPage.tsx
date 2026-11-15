import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useFirebaseAuth } from "../auth/FirebaseAuth";

export function SettingsPage() {
  const { user, signOut, isConfigured, isLoaded } = useFirebaseAuth();

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success("Signed out");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign-out failed");
    }
  };

  return (
    <div className="mission-page p-6 space-y-6 max-w-2xl">
      <div><h1 className="font-display text-2xl font-bold text-foreground">Settings</h1><p className="text-sm text-muted-foreground">Account and authentication status</p></div>
      <Card className="mission-panel">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><UserRound className="h-4 w-4 text-primary" /> Firebase account</CardTitle><CardDescription>Identity used to authenticate requests to the CloudSentinels Go API.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">Authentication SDK</span><Badge variant={isConfigured ? "default" : "destructive"}>{isConfigured ? "Configured" : "Missing configuration"}</Badge></div>
          <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">Session state</span><Badge variant={user ? "default" : "secondary"}>{!isLoaded ? "Loading" : user ? "Signed in" : "Signed out"}</Badge></div>
          {user && <><div className="space-y-1"><div className="text-xs text-muted-foreground">Email</div><div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground break-all">{user.email ?? "No email claim"}</div></div><div className="space-y-1"><div className="text-xs text-muted-foreground">Firebase UID</div><div className="rounded-md border border-border bg-muted/30 p-3 font-mono text-xs text-foreground break-all">{user.id}</div></div><Button variant="destructive" onClick={() => void handleSignOut()}><LogOut className="mr-2 h-4 w-4" /> Sign out</Button></>}
          {!user && <p className="text-sm text-muted-foreground">Sign in to access the operational workspace.</p>}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">CloudSentinels · Firebase Authentication · AWS-hosted execution remains separately controlled.</p>
    </div>
  );
}
