import { Button } from "@/components/ui/button";
import { Activity, BrainCircuit, Shield, Zap } from "lucide-react";
import { useAwsAuth } from "../aws/AwsAuth";
export function LoginPage({ authError }: { authError?: string | null }) {
 const { signIn, error, isLoaded } = useAwsAuth(); const message = authError || error;
 return <div className="min-h-screen bg-background grid-bg flex items-center justify-center p-4"><div className="relative w-full max-w-sm">
 <div className="text-center mb-8"><div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/15 border border-primary/30 glow-cyan mb-4"><Shield className="w-8 h-8 text-primary" /></div><h1 className="font-display text-3xl font-700 text-foreground text-glow mb-1">CloudSentinels</h1><p className="text-muted-foreground text-sm">AI-Powered DevOps Assistant</p></div>
 <div className="flex flex-wrap justify-center gap-2 mb-8">{[{icon:Activity,label:"Live Monitoring"},{icon:BrainCircuit,label:"AI Analysis"},{icon:Zap,label:"Instant Alerts"}].map(({icon:Icon,label})=><div key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card border border-border text-xs text-muted-foreground"><Icon className="w-3 h-3 text-primary"/>{label}</div>)}</div>
 <div className="bg-card border border-border rounded-xl p-6 shadow-2xl"><h2 className="font-display text-lg font-600 text-foreground mb-1">Sign in securely</h2><p className="text-sm text-muted-foreground mb-5">Sign in with your CloudSentinels account, secured by Amazon Cognito.</p>
 {message&&<div role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><p className="font-semibold">Authentication could not be completed</p><p className="mt-1 break-words">{message}</p></div>}
 <Button className="w-full bg-primary/90 hover:bg-primary text-primary-foreground font-semibold" onClick={()=>void signIn()} disabled={!isLoaded}><span className="flex items-center gap-2"><Shield className="w-4 h-4"/>Continue with Amazon Cognito</span></Button><p className="mt-4 text-xs text-muted-foreground text-center">Protected by AWS Cognito · Authorization Code + PKCE</p></div>
 <p className="text-center text-xs text-muted-foreground mt-6">CloudSentinels · Cloud operations and incident response</p></div></div>;
}
