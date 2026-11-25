import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || "An unexpected application error occurred.",
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Application error boundary caught:", error, errorInfo);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    let parsedDetail: { error?: string; operationType?: string; path?: string } | null = null;
    try {
      const candidate = JSON.parse(this.state.errorMessage);
      if (candidate && typeof candidate === "object" && "operationType" in candidate) {
        parsedDetail = candidate;
      }
    } catch {
      parsedDetail = null;
    }

    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 space-y-4">
          <div>
            <h1 className="font-display text-lg font-semibold text-foreground">
              Application error
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {parsedDetail
                ? `Firestore ${parsedDetail.operationType ?? "operation"} failed on ${parsedDetail.path ?? "unknown path"}.`
                : "An unexpected client error interrupted rendering."}
            </p>
          </div>
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 font-mono text-xs text-destructive break-words">
            {parsedDetail?.error ?? this.state.errorMessage}
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Reload application
          </button>
        </div>
      </div>
    );
  }
}
