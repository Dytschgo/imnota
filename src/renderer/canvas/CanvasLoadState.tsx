import { Button } from '../components/ui';

/** Shown in place of the stage while the selected screenshot is loading, or after its load failed. */
export function CanvasLoadState({ failed, onRetry }: { failed: boolean; onRetry?: () => void }) {
  return (
    <div
      className="canvas-empty canvas-load-state"
      role="status"
      data-testid="canvas-load-state"
      data-state={failed ? 'failed' : 'loading'}
    >
      {failed ? (
        <>
          <span>This screenshot could not be loaded.</span>
          {onRetry && <Button onClick={onRetry}>Retry</Button>}
        </>
      ) : (
        <span>Loading screenshot…</span>
      )}
    </div>
  );
}
