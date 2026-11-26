const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const dataFile = () => path.join(app.getPath('userData'), 'progress.json');
const SELFTEST = process.argv.includes('selftest') || process.argv.includes('--selftest');
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 880,
    minHeight: 640,
    backgroundColor: '#f4f6f9',
    title: '社会调查 · 背诵题库',
    autoHideMenuBar: true,
    show: !SELFTEST,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      offscreen: SELFTEST
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  Menu.setApplicationMenu(null);
  win.on('closed', () => { win = null; });

  if (SELFTEST) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const r = await win.webContents.executeJavaScript(
            "JSON.stringify({questions: window.QUESTION_BANK.questions.length, opts: document.querySelectorAll('#answerArea .opt').length, api: !!window.desktopAPI, typing: !!window.Typing, exam: !!window.Exam, views: document.querySelectorAll('.view').length, version: '" + app.getVersion() + "'})"
          );
          fs.writeFileSync(path.join(app.getPath('userData'), 'selftest.json'), r, 'utf8');
        } catch (e) {
          try { fs.writeFileSync(path.join(app.getPath('userData'), 'selftest.json'), 'ERR:' + e.message, 'utf8'); } catch (_) {}
        }
        app.exit(0);
      }, 1500);
    });
  }
}

ipcMain.handle('progress:load', () => {
  try {
    const f = dataFile();
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  } catch (e) {
    console.error('load progress failed', e);
  }
  return null;
});

ipcMain.handle('progress:save', (_e, text) => {
  try {
    const f = dataFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, String(text), 'utf8');
    fs.renameSync(tmp, f);
    return true;
  } catch (e) {
    console.error('save progress failed', e);
    return false;
  }
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  userData: app.getPath('userData')
}));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
