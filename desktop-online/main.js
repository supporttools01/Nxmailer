const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('node:path');

const APP_URL = 'https://supporttools01.github.io/Nxmailer/';
const ALLOWED_ORIGIN = new URL(APP_URL).origin;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    title: 'Send Mail Now',
    backgroundColor: '#0b1120',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).origin !== ALLOWED_ORIGIN) shell.openExternal(url);
    } catch {}
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    try {
      const next = new URL(url);
      if (next.origin !== ALLOWED_ORIGIN) {
        event.preventDefault();
        if (next.protocol === 'https:') shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  win.webContents.on('render-process-gone', () => {
    dialog.showErrorBox('Send Mail Now', 'The workspace window stopped unexpectedly. Please reopen the app.');
  });

  win.loadURL(APP_URL);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
