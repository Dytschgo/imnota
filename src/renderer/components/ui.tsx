import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { LoaderCircle } from 'lucide-react';

export function Button({
  className = '',
  variant = 'default',
  busy,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'soft';
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      className={`btn btn-${variant} ${className}`}
      disabled={Boolean(busy || props.disabled)}
      aria-busy={busy || undefined}
    >
      {busy && <LoaderCircle size={15} className="spin" />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

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

export function Modal({
  title,
  description,
  children,
  onClose,
  closeTestId,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  closeTestId?: string;
}) {
  const titleId = `${useId().replace(/:/g, '')}-title`;
  const descriptionId = `${useId().replace(/:/g, '')}-description`;
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ) ?? [],
      );
    (dialog?.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0] ?? dialog)?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
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
        if (event.shiftKey && document.activeElement === first) {
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
      dialog?.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="modal"
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
            ×
          </IconButton>
        </div>
        {children}
      </section>
    </div>
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
