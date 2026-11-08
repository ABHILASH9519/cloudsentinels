import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Layout } from "./components/Layout";
import { useActor } from "./hooks/useActor";
import { useClerkAuth } from "./hooks/useClerkAuth";
import { AIInsightsPage } from "./pages/AIInsightsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { IncidentDetailPage } from "./pages/IncidentDetailPage";
import { IncidentsPage } from "./pages/IncidentsPage";
import { LoginPage } from "./pages/LoginPage";
import { MonitoringPage } from "./pages/MonitoringPage";
import { SettingsPage } from "./pages/SettingsPage";

function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, error } = useClerkAuth();

  if (!isLoaded) {
    return <LoadingScreen message="Connecting to secure sign-in…" />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div
          role="alert"
          className="w-full max-w-lg rounded-xl border border-destructive/30 bg-card p-6"
        >
          <h1 className="text-lg font-semibold">Authentication unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <button
            type="button"
            className="mt-5 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return <LoginPage />;
  }

  return <AuthenticatedWorkspace>{children}</AuthenticatedWorkspace>;
}

function AuthenticatedWorkspace({
  children,
}: {
  children: React.ReactNode;
}) {
  const { actor, isFetching } = useActor();
  const { user, signOut } = useClerkAuth();
  const queryClient = useQueryClient();
  const gatewayCheck = useQuery({
    queryKey: ["gateway-auth", user?.id],
    queryFn: () => {
      if (!actor) throw new Error("Your authenticated gateway is unavailable.");
      return actor.getCallerUserRole();
    },
    enabled: !!actor && !!user,
    retry: false,
    staleTime: 30_000,
  });

  if (isFetching || gatewayCheck.isLoading) {
    return <LoadingScreen message="Verifying your secure CloudSentinels session…" />;
  }

  if (gatewayCheck.isError) {
    const message =
      gatewayCheck.error instanceof Error
        ? gatewayCheck.error.message
        : "The secure backend could not verify your session.";
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div
          role="alert"
          className="w-full max-w-lg rounded-xl border border-destructive/30 bg-card p-6"
        >
          <h1 className="text-lg font-semibold">Secure backend unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
              onClick={() =>
                void queryClient.invalidateQueries({
                  queryKey: ["gateway-auth", user?.id],
                })
              }
            >
              Retry connection
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-4 py-2 text-sm"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

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
  aiInsightsRoute,
  settingsRoute,
]);

const router = createRouter({
  routeTree,
  history: createHashHistory(),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export default function App() {
  return <RouterProvider router={router} />;
}
