import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, RouterProvider, createHashHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Layout } from "./components/Layout";
import { useAwsActor } from "./aws/useAwsActor";
import { useAwsAuth } from "./aws/AwsAuth";
import { LoginPage } from "./pages/LoginPage";
import { AIInsightsPage } from "./pages/AIInsightsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { IncidentDetailPage } from "./pages/IncidentDetailPage";
import { IncidentsPage } from "./pages/IncidentsPage";
import { MonitoringPage } from "./pages/MonitoringPage";
import { SettingsPage } from "./pages/SettingsPage";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10000 } } });
function AuthGate({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded, error } = useAwsAuth();
  if (!isLoaded) return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-sm text-muted-foreground">Initializing AWS authentication…</p></div>;
  if (!isSignedIn) return <LoginPage authError={error} />;
  return <AuthenticatedWorkspace>{children}</AuthenticatedWorkspace>;
}
function AuthenticatedWorkspace({ children }: { children: React.ReactNode }) {
  const { actor, isFetching, error } = useAwsActor();
  if (isFetching) return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-sm text-muted-foreground">Connecting to AWS services…</p></div>;
  if (!actor) return <div className="min-h-screen bg-background flex items-center justify-center p-6"><div className="w-full max-w-lg rounded-xl border border-border bg-card p-6"><h1 className="text-lg font-semibold">AWS backend unavailable</h1><p className="mt-2 text-sm text-muted-foreground">Your Cognito session is active, but the API could not be initialized.</p><div role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error instanceof Error ? error.message : "AWS API unavailable."}</div><button type="button" className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => window.location.reload()}>Retry connection</button></div></div>;
  return <>{children}</>;
}
function RootLayout() { return <AuthGate><Layout><Outlet /></Layout></AuthGate>; }
const rootRoute = createRootRoute({ component: RootLayout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: DashboardPage });
const incidentsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/incidents", component: IncidentsPage });
const incidentDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/incidents/$id", component: IncidentDetailPage });
const monitoringRoute = createRoute({ getParentRoute: () => rootRoute, path: "/monitoring", component: MonitoringPage });
const aiInsightsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/ai-insights", component: AIInsightsPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage });
const routeTree = rootRoute.addChildren([indexRoute, incidentsRoute, incidentDetailRoute, monitoringRoute, aiInsightsRoute, settingsRoute]);
const router = createRouter({ routeTree, history: createHashHistory() });
declare module "@tanstack/react-router" { interface Register { router: typeof router; } }
export default function App() { return <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>; }
