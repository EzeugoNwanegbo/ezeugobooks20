import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * App-wide safety net. Without this, any error thrown while React renders
 * unmounts the whole tree and leaves a blank page with no way to recover —
 * which is exactly what some Android users saw after an upload. Here we catch
 * it, show a recovery card, and keep the real message visible so the cause
 * isn't lost.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AppErrorBoundary] Caught render error:", error, info.componentStack);
  }

  handleReload = () => {
    // Full reload clears any corrupted in-memory state (e.g. a half-parsed
    // upload) and re-mounts the app from scratch.
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 text-center shadow-elegant">
          <h1 className="font-display text-2xl font-light leading-none">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The page hit an unexpected error. Reloading usually fixes it. If you were uploading a
            very large file, try a smaller one or split it into parts.
          </p>
          {error.message && (
            <p className="mt-3 break-words rounded-md bg-background px-3 py-2 text-left text-xs text-muted-foreground">
              {error.message}
            </p>
          )}
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-gradient-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-glow"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
