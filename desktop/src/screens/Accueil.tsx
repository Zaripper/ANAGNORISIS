import React, { useMemo, useState } from 'react';
import { Check, Pencil, X, type LucideIcon } from 'lucide-react';
import { DjemroudLogo } from '../components/AppShell';
import { Button } from '../components/ui';
import { MODULE_META, visibleScreens, type ScreenId } from '../ui/navigation';
import type { UserRole } from '@anagnorisis/shared';

/**
 * Accueil — écran d'ouverture, personnalisable.
 *
 * Chacun n'ouvre pas les mêmes écrans vingt fois par jour: un caissier veut la
 * caisse, un gestionnaire les bons de commande et l'archive. Les raccourcis se
 * choisissent donc ici, et le choix est retenu PAR UTILISATEUR de ce poste —
 * `localStorage` est indexé sur le nom de connexion, sinon deux personnes qui
 * partagent une machine s'écraseraient mutuellement.
 *
 * Le réglage est volontairement local et non serveur: il n'engage rien de
 * comptable, et un caissier ne devrait pas avoir à demander à l'administrateur
 * pour réorganiser son propre écran d'accueil.
 */

const RACCOURCIS_DEFAUT: ScreenId[] = ['CAISSE_POS', 'BONS_PREP', 'STOCKS'];
const MAX_RACCOURCIS = 8;

function cle(username?: string) {
  return `accueil.raccourcis.${username ?? 'anonyme'}`;
}

function lire(username?: string): ScreenId[] {
  try {
    const brut = localStorage.getItem(cle(username));
    if (!brut) return RACCOURCIS_DEFAUT;
    const ids = JSON.parse(brut);
    return Array.isArray(ids) ? (ids as ScreenId[]) : RACCOURCIS_DEFAUT;
  } catch {
    // Un réglage illisible ne doit pas empêcher l'écran de s'ouvrir.
    return RACCOURCIS_DEFAUT;
  }
}

export function AccueilScreen({
  username,
  role,
  onNavigate
}: {
  username?: string;
  role?: UserRole;
  onNavigate: (id: ScreenId) => void;
}) {
  const [raccourcis, setRaccourcis] = useState<ScreenId[]>(() => lire(username));
  const [edition, setEdition] = useState(false);

  const now = new Date();
  const heure = now.getHours();
  const salutation = heure < 13 ? 'Bonjour' : heure < 18 ? 'Bon après-midi' : 'Bonsoir';

  // Seuls les écrans réellement accessibles à ce rôle peuvent devenir un raccourci.
  const disponibles = useMemo(() => visibleScreens(role).filter((s) => s.implemented && s.group !== 'Accueil'), [role]);

  const choisis = useMemo(
    () => raccourcis.map((id) => disponibles.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s),
    [raccourcis, disponibles]
  );

  function enregistrer(ids: ScreenId[]) {
    setRaccourcis(ids);
    try {
      localStorage.setItem(cle(username), JSON.stringify(ids));
    } catch {
      // Stockage indisponible: le choix vaut pour la session, ce qui reste utile.
    }
  }

  function basculer(id: ScreenId) {
    if (raccourcis.includes(id)) {
      enregistrer(raccourcis.filter((x) => x !== id));
    } else if (raccourcis.length < MAX_RACCOURCIS) {
      enregistrer([...raccourcis, id]);
    }
  }

  return (
    <div className="flex-1 min-h-0 relative rounded-2xl overflow-hidden bg-[#0F5B38]/[0.045] flex items-center justify-center">
      {/* Logo en filigrane: décoratif, il ne doit jamais intercepter un clic. */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none" aria-hidden="true">
        <DjemroudLogo className="w-[32rem] h-[32rem] text-[#0F5B38] opacity-[0.05]" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-6 px-6 max-h-full overflow-auto py-6">
        <div className="text-center">
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            {salutation}
            {username ? `, ${username}` : ''}
          </h1>
          <p className="text-slate-500 text-sm mt-1.5">
            {now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {' · '}
            Exercice {now.getFullYear()}
          </p>
        </div>

        {!edition && (
          <>
            <div className="flex items-start justify-center gap-4 flex-wrap max-w-3xl">
              {choisis.map((s) => {
                const Icon = MODULE_META[s.group].icon as LucideIcon;
                return (
                  <button key={s.id} onClick={() => onNavigate(s.id)} className="group w-28 flex flex-col items-center gap-2">
                    <span className="w-16 h-16 rounded-2xl bg-white border border-[#0F5B38]/15 text-[#0F5B38] flex items-center justify-center shadow-sm transition-all duration-150 group-hover:bg-[#0F5B38] group-hover:text-white group-hover:shadow-md group-hover:-translate-y-0.5 group-active:translate-y-0">
                      <Icon className="w-7 h-7" strokeWidth={1.6} />
                    </span>
                    <span className="text-[11px] font-semibold text-slate-600 text-center leading-tight group-hover:text-slate-900">
                      {s.label}
                    </span>
                  </button>
                );
              })}

              {choisis.length === 0 && (
                <p className="text-slate-400 text-xs">Aucun raccourci. Cliquez sur « Personnaliser » pour en ajouter.</p>
              )}
            </div>

            <Button variant="secondary" size="sm" onClick={() => setEdition(true)}>
              <Pencil className="w-3.5 h-3.5" /> Personnaliser
            </Button>
          </>
        )}

        {edition && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm w-full max-w-3xl flex flex-col max-h-[60vh]">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
              <div>
                <div className="font-bold text-slate-900 text-sm">Raccourcis de l&apos;accueil</div>
                <div className="text-[11px] text-slate-400">
                  {raccourcis.length} / {MAX_RACCOURCIS} choisis — ce réglage vous est propre.
                </div>
              </div>
              <Button variant="primary" size="sm" onClick={() => setEdition(false)}>
                <Check className="w-3.5 h-3.5" /> Terminé
              </Button>
            </div>

            <div className="p-3 overflow-auto grid grid-cols-2 md:grid-cols-3 gap-1.5">
              {disponibles.map((s) => {
                const actif = raccourcis.includes(s.id);
                const plein = !actif && raccourcis.length >= MAX_RACCOURCIS;
                return (
                  <button
                    key={s.id}
                    onClick={() => basculer(s.id)}
                    disabled={plein}
                    className={`text-left px-3 py-2 rounded-xl text-[11px] font-medium transition flex items-center justify-between gap-2 border ${
                      actif
                        ? 'bg-[#0F5B38] text-white border-[#0F5B38]'
                        : plein
                          ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                    title={`${s.group} — ${s.label}`}
                  >
                    <span className="truncate">{s.label}</span>
                    {actif ? <X className="w-3 h-3 shrink-0" /> : <span className="text-[14px] leading-none shrink-0">+</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-[11px] text-slate-400 text-center">
          <kbd className="font-mono bg-white/70 border border-slate-200 px-1.5 py-0.5 rounded">Ctrl</kbd> +{' '}
          <kbd className="font-mono bg-white/70 border border-slate-200 px-1.5 py-0.5 rounded">K</kbd> pour accéder à tous les écrans
        </p>
      </div>
    </div>
  );
}
