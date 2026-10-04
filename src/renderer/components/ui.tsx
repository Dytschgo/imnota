import {
  forwardRef,
  useLayoutEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import './modal.css';
import { LoaderCircle, X } from 'lucide-react';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'soft';
    busy?: boolean;
  }
>(function Button({ className = '', variant = 'default', busy, children, ...props }, ref) {
  return (
    <button
      {...props}
      ref={ref}
      className={`btn btn-${variant} ${className}`}
      disabled={Boolean(busy || props.disabled)}
      aria-busy={busy || undefined}
    >
      {busy && <LoaderCircle size={15} className="spin" />}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(function IconButton({ label, children, className = '', ...props }, ref) {
  return (
    <button ref={ref} className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
});

export function TextInput({
  label,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className={`field ${className}`}>
      {label && <span className="field-label">{label}</span>}
      <input {...props} />
    </label>
  );
}

export function TextArea({
  label,
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <label className={`field ${className}`}>
      {label && <span className="field-label">{label}</span>}
      <textarea {...props} />
    </label>
  );
}

/** Visibility shared by tab stops and programmatic focus restoration (including statuses). */
function isAvailableFocusTarget(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert]') || element.matches(':disabled'))
    return false;
  const visibility = getComputedStyle(element).visibility;
  if (visibility === 'hidden' || visibility === 'collapse') return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (getComputedStyle(ancestor).display === 'none') return false;
    if (ancestor !== element && ancestor instanceof HTMLDetailsElement && !ancestor.open) {
      const summary = Array.from(ancestor.children).find((child) => child.tagName === 'SUMMARY');
      if (!summary?.contains(element)) return false;
    }
  }
  return true;
}

export function Modal({
  title,
  description,
  children,
  onClose,
  closeTestId,
  variant = 'default',
  hidden = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  closeTestId?: string;
  variant?: 'default' | 'preview';
  hidden?: boolean;
}) {
  const titleId = `${useId().replace(/:/g, '')}-title`;
  const descriptionId = `${useId().replace(/:/g, '')}-description`;
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button, input, textarea, select, a[href], summary, [tabindex]',
        ) ?? [],
      ).filter((element) => element.tabIndex >= 0 && isAvailableFocusTarget(element));
    const isTopDialog = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
        .filter((element) => !element.closest('[hidden]'))
        .at(-1) === dialog;
    const initialFocus = () => {
      const preferred = dialog.querySelector<HTMLElement>('[data-autofocus]');
      return preferred && isAvailableFocusTarget(preferred) ? preferred : (focusable()[0] ?? dialog);
    };
    let lastFocused: HTMLElement | null = null;
    const containFocus = (event: FocusEvent) => {
      if (!isTopDialog()) return;
      const target = event.target;
      if (target instanceof HTMLElement && dialog.contains(target)) {
        lastFocused = target;
        return;
      }
      // Background editors can autofocus after an async load. Keep the user's
      // current dialog target (including a restore status with tabIndex=-1).
      const destination =
        lastFocused && dialog.contains(lastFocused) && isAvailableFocusTarget(lastFocused)
          ? lastFocused
          : initialFocus();
      destination.focus();
    };
    document.addEventListener('focusin', containFocus, true);
    if (isTopDialog()) initialFocus().focus();
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !isTopDialog() ||
        (event.target as HTMLElement | null)?.closest('[role="dialog"]') !== dialog
      )
        return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0];
        const last = items.at(-1);
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.tabIndex < 0) {
          // Status messages and the dialog itself are programmatically focusable
          // but absent from the tab order. Advance from their document position.
          event.preventDefault();
          const direction = event.shiftKey
            ? Node.DOCUMENT_POSITION_PRECEDING
            : Node.DOCUMENT_POSITION_FOLLOWING;
          const next = (event.shiftKey ? [...items].reverse() : items).find(
            (item) => active.compareDocumentPosition(item) & direction,
          );
          (next ?? (event.shiftKey ? last : first) ?? dialog).focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    dialog?.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('focusin', containFocus, true);
      dialog?.removeEventListener('keydown', keydown);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <div
      hidden={hidden}
      className={`modal-backdrop modal-viewport modal-viewport-${variant}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className={`modal modal-${variant}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <IconButton label="Close" data-testid={closeTestId} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </IconButton>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
