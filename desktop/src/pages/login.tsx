import React, { useState } from 'react';
import { apiRequest, ApiError, getServerUrl, setServerUrl, setSession } from '../services/apiClient';
import { DjemroudLogo } from '../components/AppShell';

interface LoginProps {
  onLoginSuccess: (token: string, user: unknown) => void;
}

/**
 * Sign-in screen. On a LAN deployment each client station points at the server
 * machine once via the "Serveur" field (persisted locally); single-machine
 * setups never need to open it.
 */
export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(getServerUrl());
  const [showServer, setShowServer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Forced rotation: default/reset passwords cannot enter the app until changed.
  const [pendingSession, setPendingSession] = useState<{ token: string; user: unknown } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newPassword2, setNewPassword2] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setServerUrl(server);

    try {
      const { token, user, mustChangePassword } = await apiRequest<{ token: string; user: unknown; mustChangePassword?: boolean }>(
        '/auth/login',
        { method: 'POST', body: { username, password } }
      );
      if (mustChangePassword) {
        // Store the session so the change-password call is authenticated, but do
        // not enter the app until the rotation is done.
        setSession(token, user);
        setPendingSession({ token, user });
        return;
      }
      onLoginSuccess(token, user);
    } catch (err: unknown) {
      setError(
        err instanceof ApiError && err.message === 'INVALID_CREDENTIALS'
          ? 'Identifiants invalides.'
          : 'Impossible de contacter le serveur. Vérifiez l’adresse du serveur ci-dessous.'
      );
      setShowServer(true);
    } finally {
      setLoading(false);
    }
  };

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 6) return setError('Le nouveau mot de passe doit faire au moins 6 caractères.');
    if (newPassword !== newPassword2) return setError('Les deux saisies ne correspondent pas.');
    setLoading(true);
    try {
      await apiRequest('/auth/change-password', { method: 'POST', body: { currentPassword: password, newPassword } });
      if (pendingSession) onLoginSuccess(pendingSession.token, pendingSession.user);
    } catch (err) {
      setError(err instanceof ApiError && err.message === 'PASSWORD_UNCHANGED' ? 'Choisissez un mot de passe différent de l’actuel.' : 'Changement impossible. Réessayez.');
    } finally {
      setLoading(false);
    }
  }

  if (pendingSession) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#F6F5F1] font-sans">
        <form onSubmit={handleChangePassword} className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-sm p-8 text-xs anim-pop">
          <div className="flex flex-col items-center mb-5 text-[#0F5B38]">
            <DjemroudLogo className="w-14 h-14" />
            <h1 className="font-extrabold text-base tracking-tight mt-2 text-slate-900">Nouveau mot de passe requis</h1>
            <p className="text-slate-400 text-[11px] text-center mt-1">
              Ce compte utilise encore un mot de passe par défaut. Choisissez-en un nouveau pour continuer.
            </p>
          </div>
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-3 py-2.5 mb-4 font-medium">{error}</div>}
          <label className="block mb-3">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Nouveau mot de passe</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoFocus
              required
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/40 focus:border-[#0F5B38]"
            />
          </label>
          <label className="block mb-4">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Confirmer</span>
            <input
              type="password"
              value={newPassword2}
              onChange={(e) => setNewPassword2(e.target.value)}
              required
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/40 focus:border-[#0F5B38]"
            />
          </label>
          <button type="submit" disabled={loading} className="w-full bg-[#0F5B38] hover:bg-[#0b462b] text-white font-bold rounded-xl py-3 transition disabled:opacity-50">
            {loading ? 'Enregistrement…' : 'Changer et continuer'}
          </button>
          <button
            type="button"
            onClick={() => { setSession(null, null); setPendingSession(null); setNewPassword(''); setNewPassword2(''); }}
            className="mt-3 w-full text-slate-400 hover:text-slate-600 text-[10px] font-medium"
          >
            Annuler et revenir à la connexion
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#F6F5F1] font-sans">
      <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-sm p-8 text-xs">
        <div className="flex flex-col items-center mb-6">
          <DjemroudLogo className="w-16 h-16" />
          <h1 className="font-extrabold text-lg text-[#0F5B38] tracking-tight mt-2">ETS DJEMROUD</h1>
          <p className="text-slate-400 text-[11px]">Gestion commerciale — connectez-vous pour continuer</p>
        </div>

        {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-3 py-2.5 mb-4 font-medium">{error}</div>}

        <label className="block mb-3">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Utilisateur</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="ex: admin"
            required
            autoFocus
            className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/40 focus:border-[#0F5B38]"
          />
        </label>

        <label className="block mb-4">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Mot de passe</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/40 focus:border-[#0F5B38]"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#0F5B38] hover:bg-[#0b462b] text-white font-bold rounded-xl py-3 transition disabled:opacity-50"
        >
          {loading ? 'Connexion…' : 'Se connecter'}
        </button>

        <button
          type="button"
          onClick={() => setShowServer((s) => !s)}
          className="mt-4 text-slate-400 hover:text-slate-600 text-[10px] font-medium w-full text-center"
        >
          {showServer ? '▴ Masquer la configuration du serveur' : '▾ Configuration du serveur (postes clients)'}
        </button>
        {showServer && (
          <label className="block mt-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Adresse du serveur</span>
            <input
              type="text"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="ex: http://192.168.1.10:5000"
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/40 focus:border-[#0F5B38]"
            />
            <span className="text-[10px] text-slate-400 mt-1 block">Laissez vide sur le poste serveur (utilise cette machine).</span>
          </label>
        )}
      </form>
    </div>
  );
};
