/** Small presentational building blocks shared by every screen. */
import { useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ValidationError } from '@/security/validation';
import { AppError } from '@/services/errors';
import { VisionError } from '@/vision/camera';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  busy,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button type="button" {...rest} className={`btn btn-${variant} ${className}`} disabled={rest.disabled || busy} aria-busy={busy || undefined}>
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} {...rest} aria-invalid={error ? true : undefined} aria-describedby={hint || error ? `${id}-d` : undefined} />
      {(error || hint) && (
        <p id={`${id}-d`} className={error ? 'field-error' : 'field-hint'}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Notice({ kind = 'info', children, role }: { kind?: 'info' | 'success' | 'warn' | 'error'; children: ReactNode; role?: 'alert' | 'status' }) {
  return (
    <div className={`notice notice-${kind}`} role={role ?? (kind === 'error' ? 'alert' : 'status')}>
      {children}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" aria-selected={tab.id === value} className="tab" onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Modal dialog built on the native <dialog>: focus trap and Escape come for free. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
    >
      <header className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose} aria-label={t('common.close')}>
          ✕
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

/** A destructive action that asks once more, in place, before running. */
export function ConfirmButton({ label, confirmLabel, onConfirm, variant = 'danger' }: { label: string; confirmLabel: string; onConfirm: () => void | Promise<void>; variant?: Variant }) {
  const { t } = useTranslation();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!armed) {
    return (
      <Button variant={variant === 'danger' ? 'secondary' : variant} className={variant === 'danger' ? 'btn-danger-outline' : ''} onClick={() => setArmed(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span className="confirm">
      <Button
        variant={variant}
        busy={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setArmed(false);
          }
        }}
      >
        {confirmLabel}
      </Button>
      <Button variant="ghost" onClick={() => setArmed(false)}>
        {t('common.cancel')}
      </Button>
    </span>
  );
}

/** Translates any thrown value into a message for the user. Unknown errors are not hidden. */
export function useErrorText(): (err: unknown) => string {
  const { t } = useTranslation();
  return useCallback(
    (err: unknown) => {
      if (err instanceof AppError) return t(`errors.${err.code}`, { seconds: err.detail ?? 0 });
      if (err instanceof ValidationError) return t(`errors.${err.code}`);
      if (err instanceof VisionError) return t(`camera.error.${err.code}`);
      console.error(err);
      return `${t('errors.unexpected')} (${err instanceof Error ? err.message : String(err)})`;
    },
    [t],
  );
}

/** Runs an async action with busy and error state. */
export function useAction(): { busy: boolean; error: string | null; run: (fn: () => Promise<void>) => Promise<boolean>; clear: () => void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = useErrorText();
  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        return true;
      } catch (err) {
        setError(text(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [text],
  );
  return { busy, error, run, clear: useCallback(() => setError(null), []) };
}

/** Loads data on mount and whenever `deps` change; exposes reload(). */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const text = useErrorText();
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    loader().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (err) => alive && setState({ data: null, error: text(err), loading: false }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: useCallback(() => setTick((n) => n + 1), []) };
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
