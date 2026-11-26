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

  // ---------- 打字训练 ----------
  await win.webContents.executeJavaScript(`document.querySelector('[data-view="typing"]').click(); true`);
  await sleep(500);
  await shot('10-typing');

  const typingCheck = await win.webContents.executeJavaScript(`
    (function(){
      const ta = document.querySelector('#typeInput');
      const refBox = document.querySelector('#typeRef');
      const total = refBox.querySelectorAll('span').length;
      const q = window.__SSQ__.Bank.all.find(function(x){ return x.type === 'short'; });
      const text = refBox.textContent.slice(0, 40);
      // 输入前 20 字，其中第 5 字故意打错
      const typed = text.slice(0, 20);
      ta.value = typed.slice(0, 4) + '错' + typed.slice(5);
      ta.dispatchEvent(new Event('input'));
      const ok = refBox.querySelectorAll('span.ok').length;
      const bad = refBox.querySelectorAll('span.bad').length;
      return { spans: total, ok: ok, bad: bad, prog: document.querySelector('#stProg').textContent,
               acc: document.querySelector('#stAcc').textContent, firstId: q ? q.id : null };
    })()
  `);
  console.log('TYPING_CHECK:' + JSON.stringify(typingCheck));
  await shot('11-typing-typed');

  // 修正后打完全文，看能否自动完成并出分
  const finishCheck = await win.webContents.executeJavaScript(`
    (function(){
      const ta = document.querySelector('#typeInput');
      const ref = document.querySelector('#typeRef').textContent;
      ta.value = ref;
      ta.dispatchEvent(new Event('input'));
      return { prog: document.querySelector('#stProg').textContent, acc: document.querySelector('#stAcc').textContent };
    })()
  `);
  await sleep(700);
  const resultShown = await win.webContents.executeJavaScript(`
    (function(){
      const r = document.querySelector('#typeResult');
      return { hidden: r.hidden, text: r.textContent.replace(/\\s+/g,' ').slice(0, 80),
               best: (Store.state.typing && Object.keys(Store.state.typing).length) || 0 };
    })()
  `);
  console.log('FINISH_CHECK:' + JSON.stringify(finishCheck) + ' RESULT:' + JSON.stringify(resultShown));
  await shot('12-typing-result');

  // ---------- 章节筛选 + 逐句背 ----------
  await win.webContents.executeJavaScript(`
    (function(){
      document.querySelector('[data-view="practice"]').click();
      document.querySelector('#typeChips [data-type="short"]').click();
      return true;
    })()
  `);
  await sleep(350);
  const chap = await win.webContents.executeJavaScript(`
    (function(){
      const sel = document.querySelector('#chapterSelect');
      const opts = sel ? sel.options.length : 0;
      sel.selectedIndex = 1;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { hidden: sel.hidden, options: opts, value: sel.value,
               chapter: (window.__SSQ__.App.current || {}).chapter,
               qno: (window.__SSQ__.App.current || {}).no };
    })()
  `);
  console.log('CHAPTER:' + JSON.stringify(chap));
  await shot('17-chapter');

  const seg = await win.webContents.executeJavaScript(`
    (function(){
      const b = document.querySelector('[data-act="show-answer"]');
      if (b) b.click();
      const segBtn = Array.from(document.querySelectorAll('.ab-tools .ghost-btn'))
        .find(function(x){ return x.textContent === '逐句背'; });
      const exists = !!segBtn;
      if (segBtn) segBtn.click();
      const els = document.querySelectorAll('.seg');
      const filter = els.length ? getComputedStyle(els[0].querySelector('.seg-txt')).filter : 'none';
      if (els.length) els[0].click();
      const barEl = document.querySelector('.seg-bar');
      const bs = barEl ? getComputedStyle(barEl) : {};
      const btnEl = barEl ? barEl.querySelector('.ghost-btn') : null;
      return { btn: exists, segs: els.length, filter: filter,
               opened: document.querySelectorAll('.seg.open').length,
               barDisplay: bs.display, barWrap: bs.flexWrap,
               barW: barEl ? Math.round(barEl.getBoundingClientRect().width) : 0,
               barH: barEl ? Math.round(barEl.getBoundingClientRect().height) : 0,
               btnTop: btnEl ? Math.round(btnEl.getBoundingClientRect().top - barEl.getBoundingClientRect().top) : -1 };
    })()
  `);
  console.log('SEG:' + JSON.stringify(seg));
  await sleep(300);
  await shot('18-seg');

  // ---------- 模拟考试 ----------
  await win.webContents.executeJavaScript(`document.querySelector('[data-view="exam"]').click(); true`);
  await sleep(400);
  await shot('13-exam-start');

  const examStart = await win.webContents.executeJavaScript(`
    (function(){
      document.querySelector('#examBegin').click();
      const cards = document.querySelectorAll('.exam-q').length;
      return { cards: cards, clock: document.querySelector('#examClock').textContent };
    })()
  `);
  console.log('EXAM_START:' + JSON.stringify(examStart));
  await sleep(400);
  await shot('14-exam-run');

  const examSubmit = await win.webContents.executeJavaScript(`
    (function(){
      // 全部选 A / 判断选√ / 填空随便填，然后交卷
      document.querySelectorAll('.opt[data-k="A"]').forEach(function(b){ b.click(); });
      document.querySelectorAll('.judge-btn[data-v="√"]').forEach(function(b){ b.click(); });
      document.querySelectorAll('.exam-blanks input').forEach(function(i){ i.value = '测试'; i.dispatchEvent(new Event('input',{bubbles:true})); });
      const done = document.querySelector('#examDone').textContent;
      window.confirm = function(){ return true; };
      document.querySelector('#examSubmit').click();
      return { answered: done, hasResult: !document.querySelector('#examResult').hidden,
               score: (document.querySelector('.rh-score')||{}).textContent };
    })()
  `);
  console.log('EXAM_SUBMIT:' + JSON.stringify(examSubmit));
  await sleep(400);
  await shot('15-exam-result');

  // ---------- 统计（含热力图） ----------
  await win.webContents.executeJavaScript(`document.querySelector('[data-view="stats"]').click(); true`);
  await sleep(500);
  const heat = await win.webContents.executeJavaScript(`document.querySelectorAll('#heatGrid i').length`);
  console.log('HEAT_CELLS:' + heat);
  await shot('16-stats');

  console.log('CONSOLE_ERRORS:' + JSON.stringify(errors));
  app.quit();
}).catch(e => { console.error('FAIL', e); app.quit(); });
