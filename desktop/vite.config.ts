import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Configuration de base: sert l'interface web, rien d'autre.
 *
 * Le plugin Electron n'est PAS ici, et c'est deliberé. Quand il y etait, un
 * simple `vite` lançait aussi Electron; à la fermeture de la fenêtre Electron,
 * vite se terminait avec le code 0, et le `concurrently -k` de la racine tuait
 * l'API dans la foulée. Fermer une fenêtre arrêtait donc le serveur — inadmissible
 * pour un déploiement LAN où le serveur tourne sur un poste à part.
 *
 * La coquille Electron vit maintenant dans vite.electron.config.ts.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173
  }
});
