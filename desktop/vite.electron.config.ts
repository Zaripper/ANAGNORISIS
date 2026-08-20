import { defineConfig, mergeConfig } from 'vite';
import electron from 'vite-plugin-electron/simple';
import base from './vite.config';

/**
 * Configuration de la coquille Electron.
 *
 * Separee de la configuration de base parce que le plugin Electron lie le sort
 * de vite a celui de la fenetre: quand Electron se ferme, vite s'arrete. C'est
 * le comportement voulu quand on lance l'application de bureau, et seulement
 * dans ce cas-la.
 *
 * Utilisee par `npm run dev:app`. Le `npm run dev` ordinaire, lui, ne sert que
 * l'interface web et survit a tout.
 */
export default mergeConfig(
  base,
  defineConfig({
    plugins: [
      electron({
        main: {
          entry: 'electron/main.ts'
        },
        preload: {
          input: 'electron/preload.ts',
          vite: {
            build: {
              rollupOptions: {
                output: {
                  format: 'cjs',
                  entryFileNames: '[name].js'
                }
              }
            }
          }
        }
      })
    ]
  })
);
