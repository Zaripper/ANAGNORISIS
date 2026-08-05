import React, { useState } from 'react';
import { apiRequest, ApiError, getServerUrl, setServerUrl } from '../services/apiClient';
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setServerUrl(server);

    try {
      const { token, user } = await apiRequest<{ token: string; user: unknown }>('/auth/login', {
        method: 'POST',
        body: { username, password }
      });
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

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#FAF9F6] font-sans">
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
