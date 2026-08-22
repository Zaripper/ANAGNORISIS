import React, { useEffect, useMemo, useState } from 'react';
import { visibleScreens, type ScreenDef } from '../ui/navigation';
import { BP_DUREE_VALIDITE_KEY, LOT_ALERTE_KEY, type UserRole } from '@anagnorisis/shared';
import { apiRequest } from '../services/apiClient';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Field,
  Input,
  Modal,
  Screen,
  Select,
  ToastHost,
  dateShort,
  useToasts
} from '../components/ui';
import { describeError } from './ReferenceData';
import { CompanySettings } from '../services/print';

// ---------------------------------------------------------------------------
// Gestion des utilisateurs (admin only — enforced both here and on the API)
// ---------------------------------------------------------------------------
interface UserRow {
  id: string;
  username: string;
  role: UserRole;
  active: boolean;
  /** Droits réglés écran par écran plutôt que déduits du rôle. */
  accesPersonnalise: boolean;
  screenAccess: string[];
  createdAt: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  ADMINISTRATEUR: 'Administrateur',
  CAISSIER: 'Caissier',
  AGENT: 'Agent'
};

export function UsersScreen({ currentUserId }: { currentUserId?: string }) {
  const toasts = useToasts();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [droits, setDroits] = useState<UserRow | null>(null);

  async function load() {
    setLoading(true);
    try {
      setUsers(await apiRequest<UserRow[]>('/users'));
    } catch (err) {
      toasts.error(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <Screen
      title="Gestion des utilisateurs"
      description="Comptes de connexion des postes. Les droits d'écriture sont contrôlés par rôle côté serveur."
      maxWidth="max-w-4xl"
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Nouvel utilisateur
        </Button>
      }
    >
      <Card className="flex-1 min-h-0" padded={false}>
        <div className="p-3 flex-1 min-h-0">
          <DataTable
            loading={loading}
            columns={[
              {
                key: 'username',
                header: 'Utilisateur',
                render: (u: UserRow) => (
                  <span className="font-semibold text-slate-800">
                    {u.username}
                    {u.id === currentUserId && <span className="text-slate-400 font-normal"> (vous)</span>}
                  </span>
                )
              },
              { key: 'role', header: 'Rôle', render: (u) => ROLE_LABELS[u.role] },
              {
                key: 'acces',
                header: 'Accès',
                render: (u) =>
                  u.accesPersonnalise ? (
                    <span className="text-[11px]">
                      <span className="font-bold text-[#0F5B38]">{u.screenAccess.length}</span> écran(s) autorisé(s)
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-400">Selon le rôle</span>
                  )
              },
              {
                key: 'active',
                header: 'État',
                align: 'center',
                render: (u) => (u.active ? <Badge tone="success">Actif</Badge> : <Badge tone="neutral">Désactivé</Badge>)
              },
              { key: 'created', header: 'Créé le', render: (u) => dateShort(u.createdAt) },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (u) => (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setDroits(u)}>
                      Droits d&apos;accès
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                      Modifier
                    </Button>
                  </div>
                )
              }
            ]}
            rows={users}
            rowKey={(u) => u.id}
            emptyMessage="Aucun utilisateur."
          />
        </div>
      </Card>

      {(creating || editing) && (
        <UserModal
          user={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async (message) => {
            setCreating(false);
            setEditing(null);
            await load();
            toasts.success(message);
          }}
          onError={(m) => toasts.error(m)}
        />
      )}
      {droits && (
        <DroitsAccesModal
          user={droits}
          onClose={() => setDroits(null)}
          onSaved={async (message) => {
            setDroits(null);
            await load();
            toasts.success(message);
          }}
          onError={(m) => toasts.error(m)}
        />
      )}

      <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </Screen>
  );
}

/**
 * Droits d'accès: la liste de TOUS les écrans, à cocher un par un.
 *
 * Demande directe du propriétaire — créer une session puis parcourir les écrans
 * en décidant pour chacun. Les écrans sont groupés par menu parce que c'est
 * ainsi que l'utilisateur les connaît, et chaque groupe se coche d'un bloc: sur
 * une soixantaine d'écrans, cocher un à un serait décourageant.
 *
 * Ce que ce réglage fait, et ce qu'il ne fait pas: il décide de ce que la
 * personne peut OUVRIR. Ce que le serveur l'autorise à FAIRE reste décidé par
 * son rôle, et cette distinction est rappelée à l'écran — masquer un menu n'a
 * jamais protégé une API.
 */
function DroitsAccesModal({
  user,
  onClose,
  onSaved,
  onError
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [personnalise, setPersonnalise] = useState(user.accesPersonnalise);
  const [coches, setCoches] = useState<string[]>(user.screenAccess);
  // `screenAccess` est une liste de chaines cote serveur; la comparaison avec les
  // identifiants du registre se fait donc sur des chaines, sans conversion.
  const [saving, setSaving] = useState(false);

  // Ce que le rôle laisse voir: cocher au-delà n'aurait aucun effet.
  const parGroupe = useMemo(() => {
    const ecrans = visibleScreens({ role: user.role });
    const groupes = new Map<string, ScreenDef[]>();
    for (const e of ecrans) {
      if (e.group === 'Accueil') continue;
      if (!groupes.has(e.group)) groupes.set(e.group, []);
      groupes.get(e.group)!.push(e);
    }
    return [...groupes.entries()];
  }, [user.role]);

  const total = parGroupe.reduce((n, [, e]) => n + e.length, 0);

  function basculer(id: string) {
    setCoches((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  function basculerGroupe(ecrans: ScreenDef[]) {
    const ids: string[] = ecrans.map((e) => e.id);
    const tousCoches = ids.every((id) => coches.includes(id));
    setCoches((c) => (tousCoches ? c.filter((x) => !ids.includes(x)) : [...new Set([...c, ...ids])]));
  }

  async function enregistrer() {
    setSaving(true);
    try {
      await apiRequest(`/users/${user.id}/access`, {
        method: 'PUT',
        body: { accesPersonnalise: personnalise, screenAccess: personnalise ? coches : [] }
      });
      await onSaved(
        personnalise
          ? `${user.username}: ${coches.length} écran(s) autorisé(s).`
          : `${user.username} suit de nouveau les droits de son rôle.`
      );
    } catch (err) {
      onError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Droits d'accès — ${user.username}`}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={enregistrer} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 min-h-0">
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <Checkbox
            label="Limiter cet utilisateur à une liste d'écrans"
            checked={personnalise}
            onChange={(e) => setPersonnalise(e.target.checked)}
          />
          <p className="text-[10px] text-slate-500 mt-1 leading-snug">
            Décoché, le compte voit tous les écrans permis par son rôle ({ROLE_LABELS[user.role]}). Ce réglage décide de ce
            que la personne peut <b>ouvrir</b>; ce qu&apos;elle a le droit de <b>faire</b> reste fixé par son rôle et
            contrôlé par le serveur.
          </p>
        </div>

        {personnalise && (
          <>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-500">
                <b className="text-[#0F5B38]">{coches.length}</b> / {total} écran(s)
              </span>
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" onClick={() => setCoches(parGroupe.flatMap(([, e]) => e.map((x) => x.id as string)))}>
                  Tout cocher
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setCoches([])}>
                  Tout décocher
                </Button>
              </div>
            </div>

            <div className="overflow-auto max-h-[52vh] flex flex-col gap-2 pr-1">
              {parGroupe.map(([groupe, ecrans]) => {
                const nbCoches = ecrans.filter((e) => coches.includes(e.id)).length;
                return (
                  <div key={groupe} className="border border-slate-200 rounded-xl overflow-hidden">
                    <button
                      onClick={() => basculerGroupe(ecrans)}
                      className="w-full px-3 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[11px] font-bold text-slate-700 hover:bg-slate-100 transition"
                    >
                      <span>{groupe}</span>
                      <span className="text-slate-400 font-medium">
                        {nbCoches}/{ecrans.length} — tout {nbCoches === ecrans.length ? 'décocher' : 'cocher'}
                      </span>
                    </button>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-0.5 p-2">
                      {ecrans.map((e) => (
                        <Checkbox
                          key={e.id}
                          label={e.label}
                          checked={coches.includes(e.id)}
                          onChange={() => basculer(e.id)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function UserModal({
  user,
  onClose,
  onSaved,
  onError
}: {
  user: UserRow | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(user?.role ?? 'CAISSIER');
  const [active, setActive] = useState(user?.active ?? true);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (user) {
        await apiRequest(`/users/${user.id}`, {
          method: 'PUT',
          body: { role, active, ...(password ? { password } : {}) }
        });
        await onSaved(`Compte ${user.username} mis à jour.`);
      } else {
        if (!username.trim() || password.length < 6) {
          onError('Nom requis et mot de passe de 6 caractères minimum.');
          setSaving(false);
          return;
        }
        await apiRequest('/users', { method: 'POST', body: { username: username.trim(), password, role, active } });
        await onSaved(`Compte ${username.trim()} créé.`);
      }
    } catch (err) {
      onError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={user ? `Modifier — ${user.username}` : 'Nouvel utilisateur'}
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={saving} onClick={submit as unknown as React.MouseEventHandler<HTMLButtonElement>}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        {!user && (
          <Field label="Nom d'utilisateur" required hint="Lettres, chiffres, points, tirets.">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ex: caissier2" autoFocus />
          </Field>
        )}
        <Field label={user ? 'Nouveau mot de passe' : 'Mot de passe'} required={!user} hint={user ? 'Laisser vide pour ne pas changer.' : '6 caractères minimum.'}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </Field>
        <Field label="Rôle">
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-3.5 h-3.5" />
          Compte actif
        </label>
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Paramètres — company identity used on printed documents
// ---------------------------------------------------------------------------
const SETTING_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: 'company.name', label: 'Raison sociale' },
  { key: 'company.activity', label: 'Activité' },
  { key: 'company.address', label: 'Adresse' },
  { key: 'company.phone', label: 'Téléphone' },
  { key: 'company.email', label: 'Email' },
  { key: 'company.rc', label: 'Registre de commerce (RC)' },
  { key: 'company.nif', label: 'NIF' },
  { key: 'company.ai', label: 'Article d’imposition (AI)' },
  { key: 'company.nis', label: 'NIS' },
  { key: 'company.nin', label: "NIN (n° d'identification nationale)" },
  { key: 'print.footer', label: 'Pied de page des impressions', hint: 'Affiché en bas des factures et tickets.' }
];

/**
 * Paramètres d'exploitation — ceux qui changent le comportement du logiciel, par
 * opposition à l'identité imprimée sur les documents. Séparés visuellement pour
 * qu'on ne les modifie pas par inadvertance en corrigeant une adresse.
 */
const EXPLOITATION_FIELDS: { key: string; label: string; hint?: string }[] = [
  {
    key: BP_DUREE_VALIDITE_KEY,
    label: 'Validité des bons de préparation (jours)',
    hint: "Passé ce délai, la réservation de stock est libérée et le bon n'est plus validable. Par défaut 8 jours."
  },
  {
    key: LOT_ALERTE_KEY,
    label: 'Alerte avant péremption (jours)',
    hint: "Un lot entre en alerte à ce délai de sa date de péremption. Par défaut 90 jours. Une fois périmé, il n'est plus jamais servi à la vente."
  }
];

export function SettingsScreen({ onSaved }: { onSaved: (settings: CompanySettings) => void }) {
  const toasts = useToasts();
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest<Record<string, string>>('/settings')
      .then((s) => setValues(s))
      .catch(() => toasts.error('Impossible de charger les paramètres.'))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const updated = await apiRequest<Record<string, string>>('/settings', { method: 'PUT', body: values });
      setValues(updated);
      onSaved(updated);
      toasts.success('Paramètres enregistrés — utilisés dès la prochaine impression.');
    } catch (err) {
      toasts.error(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  const champ = (f: { key: string; label: string; hint?: string }) => (
    <div key={f.key} className={f.key === 'print.footer' || f.key === 'company.address' ? 'sm:col-span-2' : ''}>
      <Field label={f.label} hint={f.hint}>
        <Input value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
      </Field>
    </div>
  );

  return (
    <Screen
      title="Paramètres"
      description="Identité de l'entreprise imprimée sur les documents, et règles d'exploitation."
      maxWidth="max-w-2xl"
      actions={
        <Button variant="primary" onClick={save} disabled={saving || loading}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      }
    >
      <Card className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="text-slate-400 text-xs p-6 text-center">Chargement…</div>
        ) : (
          <div className="flex flex-col gap-5">
            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Identité de l'entreprise</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{SETTING_FIELDS.map(champ)}</div>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Exploitation</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{EXPLOITATION_FIELDS.map(champ)}</div>
            </div>
          </div>
        )}
      </Card>
      <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </Screen>
  );
}
