/* 仅用于开发自检：隐藏窗口渲染各视图并截图，不写入真实进度 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.tmpdir(), 'ssq-shot-profile'));

const OUT = path.join(__dirname, '_shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1180, height: 880, show: false,
    backgroundColor: '#f4f6f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      offscreen: true
    }
  });

  let lastFrame = null;
  win.webContents.on('paint', (_e, _dirty, image) => { lastFrame = image; });
  win.webContents.setFrameRate(30);

  const errors = [];
  win.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) errors.push(msg);
  });
  win.webContents.on('render-process-gone', (_e, d) => errors.push('render gone: ' + JSON.stringify(d)));

  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  await win.webContents.insertCSS('*{animation:none!important;transition:none!important}');
  await sleep(900);

  const diag = await win.webContents.executeJavaScript(`
    (function(){
      return {
        bank: window.QUESTION_BANK ? window.QUESTION_BANK.questions.length : -1,
        qbodyHidden: document.querySelector('#qbody').hidden,
        emptyHidden: document.querySelector('#emptyState').hidden,
        stem: (document.querySelector('#qStem').textContent||'').slice(0,60),
        opts: document.querySelectorAll('#answerArea .opt').length,
        cardRect: (function(r){return [Math.round(r.width),Math.round(r.height)];})(document.querySelector('#qcard').getBoundingClientRect()),
        viewOpacity: getComputedStyle(document.querySelector('#view-practice')).opacity
      };
    })()
  `);
  console.log('DIAG:' + JSON.stringify(diag));

  async function shot(name) {
    await sleep(280);
    const img = lastFrame || await win.capturePage();
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
    console.log('shot', name, img.getSize());
  }

  await shot('01-practice');

  // 答一道单选题
  await win.webContents.executeJavaScript(`
    (function(){ const b = document.querySelector('#answerArea .opt'); if(b) b.click(); return !!b; })()
  `);
  await sleep(400);
  await shot('02-single-answered');

  // 判断题
  await win.webContents.executeJavaScript(`
    (function(){
      document.querySelector('#typeChips [data-type="judge"]').click();
      return document.querySelector('#qType').textContent;
    })()
  `);
  await sleep(400);
  await shot('03-judge');

  // 填空题
  await win.webContents.executeJavaScript(`
    (function(){
      document.querySelector('#typeChips [data-type="blank"]').click();
      const i = document.querySelector('.blank-input'); if(i){ i.value='应用性'; }
      return document.querySelectorAll('.blank-input').length;
    })()
  `);
  await sleep(400);
  await shot('04-blank');

  // 主观题 + 显示答案
  await win.webContents.executeJavaScript(`
    (function(){
      document.querySelector('#typeChips [data-type="short"]').click();
      const b = document.querySelector('[data-act="show-answer"]'); if(b) b.click();
      return true;
    })()
  `);
  await sleep(500);
  await shot('05-short-answer');

  // 实操题（含表格那题）
  await win.webContents.executeJavaScript(`
    (function(){
      document.querySelector('#typeChips [data-type="prac"]').click();
      return document.querySelector('#qStem').textContent.slice(0,40);
    })()
  `);
  await sleep(400);
  await shot('06-prac');

  // 表格题（第 12 题）
  await win.webContents.executeJavaScript(`
    (function(){
      window.__SSQ__.renderQuestion(window.__SSQ__.Bank.byId['prac-012']);
      return true;
    })()
  `);
  await sleep(400);
  await shot('06b-prac-table');

  // 填空判分：填入正确答案后提交
  await win.webContents.executeJavaScript(`
    (function(){
      document.querySelector('#typeChips [data-type="blank"]').click();
      const q = window.__SSQ__.App.current;
      const ins = Array.from(document.querySelectorAll('.blank-input'));
      ins.forEach((el,i)=>{ el.value = (q.blanks[i]||'').split(/[（(]/)[0]; });
      document.querySelector('[data-act="submit-blank"]').click();
      return document.querySelector('#feedback').textContent;
    })()
  `);
  await sleep(400);
  await shot('04b-blank-submitted');

  // 题库浏览
  await win.webContents.executeJavaScript(`document.querySelector('[data-view="browse"]').click(); true`);
  await sleep(500);
  await win.webContents.executeJavaScript(`(function(){ const h=document.querySelector('.item-head'); if(h) h.click(); return true; })()`);
  await sleep(300);
  await shot('07-browse');

  // 统计
  await win.webContents.executeJavaScript(`document.querySelector('[data-view="stats"]').click(); true`);
  await sleep(500);
  await shot('08-stats');

  // 设置
  await win.webContents.executeJavaScript(`document.querySelector('[data-view="settings"]').click(); true`);
  await sleep(400);
  await shot('09-settings');

  console.log('CONSOLE_ERRORS:' + JSON.stringify(errors));
  app.quit();
}).catch(e => { console.error('FAIL', e); app.quit(); });
