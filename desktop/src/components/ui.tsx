import React, { useEffect, useMemo, useRef, useState } from 'react';
import { dansIntervalleDates, enDateInput, exerciceCourant, moisCourant } from '@anagnorisis/shared';

/**
 * Shared UI primitives for the whole application.
 *
 * Every screen renders through these components so spacing, colour, focus rings,
 * empty states and loading states stay identical everywhere. Before this existed
 * each screen hand-rolled its own markup, which is why the app drifted into two
 * conflicting visual styles (modern cards vs. Windows-98 grey dialogs).
 *
 * Rule of thumb: if you are about to write `className="bg-white border border-slate-200
 * rounded-2xl ..."` in a screen, use <Card> instead.
 */

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
export const BRAND = '#0F5B38';
export const BRAND_DARK = '#0b462b';

/** Tailwind fragment for a consistent keyboard focus ring. */
const FOCUS = 'focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/40 focus:border-[#0F5B38]';

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-[#0F5B38] text-white border-[#0F5B38] hover:bg-[#0b462b] disabled:hover:bg-[#0F5B38]',
  secondary: 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50',
  danger: 'bg-rose-600 text-white border-rose-600 hover:bg-rose-700 disabled:hover:bg-rose-600',
  ghost: 'bg-transparent text-slate-600 border-transparent hover:bg-slate-100'
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-xl border font-semibold transition',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-4 py-2 text-xs',
        BUTTON_VARIANTS[variant],
        FOCUS,
        className
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Layout: Screen + Card
// ---------------------------------------------------------------------------

/**
 * Standard page wrapper: title, optional description, optional right-aligned
 * actions, then content. Every screen uses this so headers never drift.
 */
export function Screen({
  title,
  description,
  actions,
  children,
  maxWidth = 'max-w-7xl'
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    <div className={cx('flex-1 flex flex-col gap-4 overflow-hidden w-full mx-auto z-10', maxWidth)}>
      <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-xs flex justify-between items-start gap-4 shrink-0">
        <div className="min-w-0">
          <h1 className="font-extrabold text-slate-900 text-base truncate">{title}</h1>
          {description && <p className="text-slate-500 text-[11px] mt-1">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Card({
  children,
  className,
  padded = true,
  title,
  actions
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
  title?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={cx('bg-white border border-slate-200 rounded-2xl shadow-xs flex flex-col min-h-0', className)}>
      {(title || actions) && (
        <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center gap-3 shrink-0">
          {title && <span className="font-bold text-slate-900 text-xs">{title}</span>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cx(padded ? 'p-4' : '', 'flex-1 min-h-0 flex flex-col')}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------
export function Field({
  label,
  children,
  hint,
  error,
  required
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </span>
      {children}
      {error ? (
        <span className="text-[10px] text-rose-600 font-medium">{error}</span>
      ) : (
        hint && <span className="text-[10px] text-slate-400">{hint}</span>
      )}
    </label>
  );
}

const CONTROL = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white transition';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} {...rest} className={cx(CONTROL, FOCUS, className)} />;
  }
);

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(CONTROL, FOCUS, className)}>
      {children}
    </select>
  );
}

export function Checkbox({ label, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
      <input
        type="checkbox"
        {...rest}
        className="w-3.5 h-3.5 rounded border-slate-300 text-[#0F5B38] focus:ring-2 focus:ring-[#0F5B38]/40"
      />
      {label}
    </label>
  );
}

/**
 * Filtre une liste sur du texte libre.
 *
 * Regroupe ici parce que la meme mecanique (etat, normalisation, inclusion sur
 * plusieurs champs) etait recopiee dans chaque ecran, et qu'un ecran sur deux
 * l'oubliait purement et simplement. La comparaison est insensible a la casse
 * ET aux accents: chercher "perime" doit trouver "périmé", sinon le champ ne
 * sert a rien sur un catalogue francais.
 */
export function useTextFilter<T>(rows: T[], champs: (row: T) => (string | number | null | undefined)[]) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = normaliser(search);
    if (!q) return rows;
    return rows.filter((row) =>
      champs(row).some((v) => (v === null || v === undefined ? false : normaliser(String(v)).includes(q)))
    );
    // `champs` est une lambda recreee a chaque rendu: la lister ferait recalculer
    // le filtre en permanence sans rien changer au resultat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search]);

  return { search, setSearch, filtered };
}

/** Minuscules sans accents, pour que la recherche se comporte comme on l'attend. */
export function normaliser(v: string) {
  return v
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Filtre une liste sur une période.
 *
 * Regroupé pour la même raison que `useTextFilter`: la mécanique se recopiait
 * d'écran en écran. Les bornes sont inclusives et raisonnent en jours entiers
 * (voir `dansIntervalleDates`), et les raccourcis évitent de saisir deux dates
 * pour la question la plus fréquente — « et aujourd'hui ? ».
 */
export function useDateRange<T>(rows: T[], getDate: (row: T) => string | Date | null | undefined) {
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');

  const filtered = useMemo(() => {
    if (!du && !au) return rows;
    return rows.filter((row) => dansIntervalleDates(getDate(row), du, au));
    // `getDate` est une lambda recréée à chaque rendu: la lister relancerait le
    // filtre en permanence sans changer le résultat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, du, au]);

  return { du, setDu, au, setAu, filtered, actif: !!(du || au), reset: () => { setDu(''); setAu(''); } };
}

/**
 * Sélecteur de période: deux dates et trois raccourcis.
 *
 * `Aujourd'hui` pose la même date des deux côtés — d'où l'importance que la
 * borne de fin couvre la journée entière, sans quoi ce bouton ne rendrait
 * jamais rien.
 */
export function DateRangeFilter({
  du,
  au,
  onDu,
  onAu,
  onReset,
  actif
}: {
  du: string;
  au: string;
  onDu: (v: string) => void;
  onAu: (v: string) => void;
  onReset: () => void;
  actif: boolean;
}) {
  const poser = (bornes: { du: string; au: string }) => {
    onDu(bornes.du);
    onAu(bornes.au);
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Du</label>
      <input
        type="date"
        value={du}
        onChange={(e) => onDu(e.target.value)}
        className={cx(CONTROL, FOCUS, 'w-32 py-1')}
        aria-label="Date de début"
      />
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Au</label>
      <input
        type="date"
        value={au}
        onChange={(e) => onAu(e.target.value)}
        className={cx(CONTROL, FOCUS, 'w-32 py-1')}
        aria-label="Date de fin"
      />
      <Button size="sm" variant="secondary" onClick={() => poser({ du: enDateInput(new Date()), au: enDateInput(new Date()) })}>
        Aujourd&rsquo;hui
      </Button>
      <Button size="sm" variant="secondary" onClick={() => poser(moisCourant())}>
        Ce mois
      </Button>
      <Button size="sm" variant="secondary" onClick={() => poser(exerciceCourant())}>
        Exercice
      </Button>
      {actif && (
        <Button size="sm" variant="ghost" onClick={onReset}>
          Tout
        </Button>
      )}
    </div>
  );
}

/** Debounced-feel search box with a magnifier affordance and clear button. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Rechercher...',
  autoFocus
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">⌕</span>
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cx(CONTROL, FOCUS, 'pl-8 pr-8')}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 px-1"
          aria-label="Effacer la recherche"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-rose-50 text-rose-700',
  info: 'bg-sky-50 text-sky-700'
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={cx('px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap', TONES[tone])}>{children}</span>;
}

/**
 * Description unique des statuts de document: libellé, ton du badge et classes
 * de la puce compacte. Ajouter un statut ici suffit à le faire apparaître
 * correctement partout — c'est ce qui a manqué quand EXPIRE est arrivé.
 */
const STATUS_LABELS: Record<string, string> = {
  OUVERT: 'Ouvert',
  VALIDE: 'Validé',
  ANNULE: 'Annulé',
  EXPIRE: 'Expiré'
};

const STATUS_TONE: Record<string, Tone> = {
  OUVERT: 'warning',
  VALIDE: 'success',
  ANNULE: 'danger',
  EXPIRE: 'neutral'
};

const STATUS_CHIP: Record<string, string> = {
  OUVERT: 'bg-amber-50 text-amber-700',
  VALIDE: 'bg-emerald-50 text-emerald-700',
  ANNULE: 'bg-rose-50 text-rose-700',
  EXPIRE: 'bg-slate-100 text-slate-500'
};

export function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

export function statusChipClasses(status: string) {
  return STATUS_CHIP[status] ?? STATUS_CHIP.OUVERT;
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'warning'}>{statusLabel(status)}</Badge>;
}

// ---------------------------------------------------------------------------
// DataTable
// ---------------------------------------------------------------------------
export interface Column<T> {
  key: string;
  header: string;
  /** Cell renderer. Keep it pure — it runs for every row on every render. */
  render: (row: T) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
}

/**
 * The single table implementation for the app. Handles sticky headers, hover and
 * selection states, loading skeletons, and the empty state — all of which used to
 * be re-implemented (inconsistently) per screen.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey,
  loading,
  emptyMessage = 'Aucun élément.',
  footer
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  loading?: boolean;
  emptyMessage?: string;
  footer?: React.ReactNode;
}) {
  const alignClass = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');

  return (
    <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-slate-100">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0 z-10">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cx('p-3 font-semibold text-[10px] uppercase tracking-wide', alignClass(c.align))} style={c.width ? { width: c.width } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading && (
            <tr>
              <td colSpan={columns.length} className="p-8 text-center text-slate-400">
                Chargement...
              </td>
            </tr>
          )}
          {!loading &&
            rows.map((row) => {
              const key = rowKey(row);
              const selected = selectedKey === key;
              return (
                <tr
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cx(
                    'transition',
                    onRowClick && 'cursor-pointer',
                    selected ? 'bg-[#0F5B38]/5' : onRowClick && 'hover:bg-slate-50'
                  )}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cx('p-3', alignClass(c.align))}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="p-10 text-center text-slate-400">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
        {footer && <tfoot className="sticky bottom-0 bg-slate-50 border-t border-slate-200">{footer}</tfoot>}
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

/** Accessible modal: closes on Escape and on backdrop click, traps initial focus. */
export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  width = 'max-w-lg'
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx('bg-white rounded-2xl shadow-2xl border border-slate-200 w-full flex flex-col max-h-[85vh] text-xs', width)}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-start gap-4 shrink-0">
          <div className="min-w-0">
            <h2 className="font-bold text-slate-900 text-sm">{title}</h2>
            {description && <p className="text-[11px] text-slate-400 mt-0.5">{description}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 font-bold p-1 shrink-0" aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="p-5 flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2 shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feedback: EmptyState, ErrorBanner, Toast
// ---------------------------------------------------------------------------
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center p-10">
      <div className="text-center max-w-sm">
        <div className="font-bold text-slate-700 text-sm mb-1">{title}</div>
        {description && <div className="text-slate-400 text-xs mb-4">{description}</div>}
        {action}
      </div>
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 flex justify-between items-center gap-3 text-xs">
      <span className="font-medium">{message}</span>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  );
}

export interface ToastMessage {
  id: number;
  tone: 'success' | 'error' | 'info';
  text: string;
}

/**
 * Minimal toast host. Screens previously reported success/failure by silently
 * doing nothing or by throwing an unhandled promise rejection into the console;
 * this gives every mutation visible feedback.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const counter = useRef(0);

  function push(tone: ToastMessage['tone'], text: string) {
    const id = ++counter.current;
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }

  return {
    toasts,
    success: (text: string) => push('success', text),
    error: (text: string) => push('error', text),
    info: (text: string) => push('info', text),
    dismiss: (id: number) => setToasts((t) => t.filter((x) => x.id !== id))
  };
}

export function ToastHost({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-[60] pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={cx(
            'pointer-events-auto cursor-pointer px-4 py-2.5 rounded-xl shadow-lg border text-xs font-medium max-w-sm',
            t.tone === 'success'
              ? 'bg-emerald-600 text-white border-emerald-700'
              : t.tone === 'info'
                ? 'bg-slate-800 text-white border-slate-900'
                : 'bg-rose-600 text-white border-rose-700'
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Amounts are Decimal on the server and arrive as strings — always coerce. */
export function num(v: unknown): number {
  return Number(v ?? 0);
}

/** Consistent money rendering. Algerian dinar, 2 decimals, thousands separated. */
export function money(v: unknown): string {
  return num(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function dateShort(v: string | Date): string {
  return new Date(v).toLocaleDateString('fr-FR');
}

export function dateTime(v: string | Date): string {
  return new Date(v).toLocaleString('fr-FR');
}
