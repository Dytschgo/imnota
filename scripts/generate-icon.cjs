/* eslint-disable @typescript-eslint/no-require-imports */
/* global console, require */
// Rebuild the code-native placeholder mark: electron scripts/generate-icon.cjs.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      width: 1024,
      height: 1024,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const svg = await fs.readFile(path.resolve('build/icon.svg'), 'utf8');
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent('<style>html,body{margin:0;width:1024px;height:1024px;overflow:hidden;background:transparent}</style>' + svg)}`,
    );
    const image = await win.webContents.capturePage();
    await fs.writeFile(path.resolve('build/icon.png'), image.toPNG());
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
