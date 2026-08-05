import { app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      // Correct path to generated preload.js in dist-electron
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In development, vite-plugin-electron launches this process with the dev-server
  // URL. Falling back to the packaged bundle when that variable is missing used to
  // silently show a STALE build (the symptom: "my changes aren't there"), so the
  // fallback is now explicit and logged.
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const bundle = path.join(__dirname, '../dist/index.html');
    if (!fs.existsSync(bundle)) {
      throw new Error(`Aucun bundle trouvé à ${bundle}. Lancez "npm run dev" pour le mode développement, ou "npm run build" avant "npm start".`);
    }
    console.log(`[electron] mode production — chargement de ${bundle}`);
    mainWindow.loadFile(bundle);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

// Without this, a throw inside createWindow leaves Electron running with no window
// and no message — the failure mode that made this hard to diagnose.
process.on('uncaughtException', (error) => {
  console.error('[electron] erreur fatale au démarrage:', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});