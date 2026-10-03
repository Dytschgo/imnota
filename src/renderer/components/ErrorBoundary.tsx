import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { reloadWindow } from '../app/reload-guard';
import { Button } from './ui';
import './error-boundary.css';

interface ErrorBoundaryProps {
  /** `app` replaces the whole window; `panel` replaces one area and leaves the rest usable. */
  variant: 'app' | 'panel';
  /** A panel boundary recovers on its own when this changes, e.g. when another item is opened. */
  resetKey?: unknown;
  /** Saves pending work, then reloads. Resolves false when the save failed and nothing was reloaded. */
  onReload?(options: { discardUnsaved?: boolean }): Promise<boolean>;
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
  reload: 'idle' | 'saving' | 'unsaved';
}

const COPY = {
  app: {
    title: 'Imnota ran into a problem',
    description:
      'Something went wrong while showing this window. Reload to continue; Imnota saves your pending changes first.',
  },
  panel: {
    title: 'This item could not be shown',
    description:
      'Something went wrong while showing it. The rest of Imnota still works: try again, open another item, or reload.',
  },
} as const;

/** Keeps a render failure from blanking the window, and reloads only through the save protection. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false, reload: 'idle' };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { failed: true, reload: 'idle' };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Imnota could not render part of the window.', error, info.componentStack);
  }

  componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.failed && !Object.is(previous.resetKey, this.props.resetKey))
      this.setState({ failed: false, reload: 'idle' });
  }

  private reload = async (discardUnsaved: boolean): Promise<void> => {
    this.setState({ reload: 'saving' });
    let reloaded = false;
    try {
      reloaded = await (this.props.onReload ?? reloadWindow)({ discardUnsaved });
    } catch {
      reloaded = false;
    }
    if (!reloaded) this.setState({ reload: 'unsaved' });
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const { variant } = this.props;
    const { reload } = this.state;
    const copy = COPY[variant];
    return (
      <div
        className={`error-fallback error-fallback-${variant}`}
        role="alert"
        data-testid={`error-fallback-${variant}`}
      >
        <div className="error-fallback-icon">
          <TriangleAlert size={22} aria-hidden="true" />
        </div>
        <h2>{copy.title}</h2>
        <p>{copy.description}</p>
        {reload === 'unsaved' && (
          <p className="error-fallback-warning">
            Your latest changes could not be saved. Reloading now may lose them.
          </p>
        )}
        <div className="error-fallback-actions">
          {variant === 'panel' && (
            <Button variant="primary" onClick={() => this.setState({ failed: false, reload: 'idle' })}>
              Try again
            </Button>
          )}
          <Button
            variant={variant === 'app' ? 'primary' : 'default'}
            busy={reload === 'saving'}
            onClick={() => void this.reload(false)}
          >
            {reload === 'unsaved' ? 'Save and reload' : 'Reload'}
          </Button>
          {reload === 'unsaved' && (
            <Button variant="danger" onClick={() => void this.reload(true)}>
              Reload without saving
            </Button>
          )}
        </div>
      </div>
    );
  }
}
