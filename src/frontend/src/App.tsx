import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { useFirebaseAuth } from "./auth/FirebaseAuth";
import { Layout } from "./components/Layout";
import { getCloudSentinelsConfigError } from "./lib/cloudSentinels";
import { AIInsightsPage } from "./pages/AIInsightsPage";
import { ClustersPage } from "./pages/ClustersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { IncidentDetailPage } from "./pages/IncidentDetailPage";
import { IncidentsPage } from "./pages/IncidentsPage";
import { LoginPage } from "./pages/LoginPage";
import { MonitoringPage } from "./pages/MonitoringPage";
import { SettingsPage } from "./pages/SettingsPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10000 } },
});
function AuthGate({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded, error } = useFirebaseAuth();
  if (!isLoaded)
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Initializing authentication…
        </p>
      </div>
    );
  if (!isSignedIn) return <LoginPage authError={error} />;
  return <ApiGate>{children}</ApiGate>;
}
function ApiGate({ children }: { children: React.ReactNode }) {
  const configError = getCloudSentinelsConfigError();
  if (configError)
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6">
          <h1 className="text-lg font-semibold">
            CloudSentinels API unavailable
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your Firebase session is active, but the Go API endpoint is not
            configured.
          </p>
          <div
            role="alert"
            className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {configError}
          </div>
          <button
            type="button"
            className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            Retry connection
          </button>
        </div>
      </div>
    );
  return <>{children}</>;
}
function RootLayout() {
  return (
    <AuthGate>
      <Layout>
        <Outlet />
      </Layout>
    </AuthGate>
  );
}
const rootRoute = createRootRoute({ component: RootLayout });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});
const incidentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/incidents",
  component: IncidentsPage,
});
const incidentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/incidents/$id",
  component: IncidentDetailPage,
});
const monitoringRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/monitoring",
  component: MonitoringPage,
});
const clustersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clusters",
  component: ClustersPage,
});
const aiInsightsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ai-insights",
  component: AIInsightsPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});
const routeTree = rootRoute.addChildren([
  indexRoute,
  incidentsRoute,
  incidentDetailRoute,
  monitoringRoute,
  clustersRoute,
  aiInsightsRoute,
  settingsRoute,
]);
const router = createRouter({ routeTree, history: createHashHistory() });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
