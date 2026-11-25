/* 端到端自检 v2：日志写入文件，避免 stdout 被吞；两阶段验证持久化与恢复 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const UD = path.join(os.tmpdir(), 'ssq-e2e-stable');
fs.mkdirSync(UD, { recursive: true });
app.disableHardwareAcceleration();
app.setPath('userData', UD);

const LOG = path.join(__dirname, '_e2e.log');
const lines = [];
function log(...a) {
  const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
  lines.push(s);
  fs.writeFileSync(LOG, lines.join('\n'), 'utf8');
}

const dataFile = () => path.join(app.getPath('userData'), 'progress.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

ipcMain.handle('progress:load', () => {
  try { if (fs.existsSync(dataFile())) return fs.readFileSync(dataFile(), 'utf8'); } catch (e) {}
  return null;
});
ipcMain.handle('progress:save', (_e, text) => {
  try {
    fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
    fs.writeFileSync(dataFile(), String(text), 'utf8');
    return true;
  } catch (e) { log('SAVE_ERR', String(e)); return false; }
});
ipcMain.handle('app:info', () => ({ version: 'e2e' }));

async function boot() {
  const win = new BrowserWindow({
    width: 1100, height: 820, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, offscreen: true
    }
  });
  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  await sleep(700);
  return win;
}

const PHASE = process.env.SSQ_PHASE || '1';

app.whenReady().then(async () => {
  try {
    if (PHASE === '1') {
      const win = await boot();
      const ids = await win.webContents.executeJavaScript(`
        (function(){
          const out = [];
          for (let i = 0; i < 5; i++) {
            const q = window.__SSQ__.App.current;
            if (!q) break;
            out.push(q.id);
            const b = document.querySelector('#answerArea .opt');
            if (b) b.click();
            const n = document.querySelector('#btnNext');
            if (n) n.click();
          }
          return out;
        })()
      `);
      log('PHASE1_ANSWERED', ids.join(','));
      await sleep(1000);

      const exists = fs.existsSync(dataFile());
      log('FILE_EXISTS', String(exists));
      if (exists) {
        const obj = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
        log('STORED_Q', String(Object.keys(obj.questions || {}).length));
        log('DAILY', JSON.stringify(obj.daily));
        log('META', JSON.stringify(obj.meta));
        const k = Object.keys(obj.questions || {})[0];
        log('SAMPLE', k, JSON.stringify(obj.questions[k]));
      }

      const blank = await win.webContents.executeJavaScript(`
        (function(){
          const f = window.__SSQ__.checkBlank;
          return [
            ['样本容量', f('样本容量','样本容量（样本规模）')],
            ['样本规模', f('样本规模','样本容量（样本规模）')],
            ['推断', f('推断','推断（推论）')],
            ['乱答', f('乱答','样本容量（样本规模）')],
            ['应用性', f('应用性','应用性')]
          ];
        })()
      `);
      log('BLANK_CHECK', JSON.stringify(blank));
      win.destroy();
      await sleep(400);
    } else {
      const win = await boot();
      const st = await win.webContents.executeJavaScript(`
        (function(){
          return {
            today: document.querySelector('#tsToday').textContent,
            streak: document.querySelector('#tsStreak').textContent,
            progress: document.querySelector('#plNum').textContent,
            opts: document.querySelectorAll('#answerArea .opt').length,
            due: document.querySelector('#tsDue').textContent
          };
        })()
      `);
      log('PHASE2_RESTORED', JSON.stringify(st));
      win.destroy();
      await sleep(400);
    }
    log('DONE');
  } catch (e) {
    log('FAIL', e.message + ' | ' + String(e.stack || '').split('\n')[1]);
  }
  app.quit();
});
