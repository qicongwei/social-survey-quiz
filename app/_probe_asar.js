/* 临时探针：直接加载 dist 里 app.asar 的渲染页，验证打包产物的填空反馈 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.tmpdir(), 'ssq-asar-probe'));

const ASAR = path.resolve(__dirname, '..', 'dist', '社会调查背诵题库-win32-x64', 'resources', 'app.asar');
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1180, height: 880, show: false,
    webPreferences: {
      preload: path.join(ASAR, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, offscreen: true
    }
  });
  let lastFrame = null;
  win.webContents.on('paint', (_e, _d, image) => { lastFrame = image; });
  win.webContents.setFrameRate(30);

  await win.loadFile(path.join(ASAR, 'renderer', 'index.html'));
  await win.webContents.insertCSS('*{animation:none!important;transition:none!important}');
  await sleep(1200);

  const hasNew = await win.webContents.executeJavaScript(`(function(){
    return {
      asarPage: location.href.indexOf('app.asar') >= 0,
      appJsHasNewFn: typeof window.__SSQ__ !== 'undefined',
      bank: window.QUESTION_BANK ? window.QUESTION_BANK.questions.length : -1
    };
  })()`);
  console.log('LOADED:' + JSON.stringify(hasNew));

  const res = await win.webContents.executeJavaScript(`(function(){
    const A = window.__SSQ__;
    A.startSession('blank', {});
    const App = A.App;
    const q = App.current;
    const ins = Array.from(document.querySelectorAll('#qStem .blank-input'));
    ins.forEach(function(i,k){ i.value = '错误答案'; i.dispatchEvent(new Event('input',{bubbles:true})); });
    document.querySelector('[data-act="submit-blank"]').click();
    const fb = document.getElementById('feedback');
    return {
      id: q.id,
      fbText: fb.textContent.replace(/\\s+/g,' ').trim(),
      rows: fb.querySelectorAll('.fb-row').length,
      col: fb.classList.contains('col'),
      autoAttr: document.getElementById('btnNext').hasAttribute('data-auto')
    };
  })()`);
  console.log('ASAR_WRONG:' + JSON.stringify(res));

  const img = lastFrame || await win.capturePage();
  fs.writeFileSync(path.resolve(__dirname, '_shots', '50-asar-wrong.png'), img.toPNG());
  app.quit();
}).catch(e => { console.log('FATAL:' + e.message); app.quit(); });
