/* global Store, Scheduler, QUESTION_BANK */
(function () {
  'use strict';

  const TYPE_NAME = { single: '单项选择', judge: '判断题', blank: '填空题', short: '名词解释 / 简答', prac: '实操题' };
  const TYPE_SHORT = { single: '单选', judge: '判断', blank: '填空', short: '名解简答', prac: '实操' };
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

  const Bank = (function () {
    const all = (window.QUESTION_BANK && window.QUESTION_BANK.questions) || [];
    const byId = {};
    all.forEach(q => { byId[q.id] = q; });
    return { all, byId, meta: (window.QUESTION_BANK && window.QUESTION_BANK.meta) || {} };
  })();

  const App = {
    view: 'practice',
    filter: 'all',
    chapter: '',
    wrongMode: false,
    starMode: false,
    browseType: 'all',
    session: null,
    current: null,
    answered: false,
    requeue: {},
    goalHit: '',
    autoTimer: null,      // 答对后自动跳题的计时器
    autoCdTimer: null,    // 按钮上的倒计时刷新计时器
    versionFilled: false, // 设置页版本信息只填一次
    submitStamp: 0,       // 最近一次提交时间，防止同一次 Enter 又触发「下一题」
    composeStamp: 0,      // 最近一次输入法上屏时间，防止选词用的 Enter 被当成提交
    seen: null,           // 本次会话已出现过的题 id，加练时不重复
    wrongStreak: {}       // 错题强化：当前连续答对次数
  };

  const AUTO_NEXT_DELAY = 1500;        // 答对后停顿，留时间读完正确答案
  const AUTO_NEXT_DELAY_BLANK = 2200;  // 填空题要读完「你填的 / 正确的」逐空对照，停顿给长一些
  const WRONG_PASS_NEED = 2;     // 错题强化：连续答对几次才算过
  const REQUEUE_MAX = 3;         // 同一题在本轮最多重现几次，防止无限循环

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function autoNextOn() {
    return !Store.state || Store.state.settings.autoNext !== false;
  }

  function shuffleOn() {
    return !!(Store.state && Store.state.settings.shuffle);
  }

  function shuffledArr(a) {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = r[i]; r[i] = r[j]; r[j] = t;
    }
    return r;
  }

  function clearAuto() {
    if (App.autoTimer) { clearTimeout(App.autoTimer); App.autoTimer = null; }
    if (App.autoCdTimer) { clearInterval(App.autoCdTimer); App.autoCdTimer = null; }
    const cd = qs('#btnNext .auto-cd');
    if (cd) cd.remove();
  }

  /** 在「下一题」按钮上跑一个可见的倒计时，让用户知道马上会自动翻页 */
  function startAutoCountdown(btn, ms) {
    let cd = btn.querySelector('.auto-cd');
    if (!cd) {
      cd = document.createElement('i');
      cd.className = 'auto-cd';
      btn.appendChild(cd);
    }
    let left = ms;
    const paint = () => { cd.textContent = (Math.max(0, left) / 1000).toFixed(1) + 's'; };
    paint();
    App.autoCdTimer = setInterval(() => {
      left -= 100;
      paint();
      if (left <= 0) { clearInterval(App.autoCdTimer); App.autoCdTimer = null; }
    }, 100);
  }

  let toastTimer = null;
  function toast(msg) {
    const el = qs('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
  }

  function normText(s) {
    return String(s || '')
      .replace(/[\s\u3000]/g, '')
      .replace(/[，,。.；;：:、！!？?（）()【】\[\]“”"'’‘]/g, '')
      .replace(/[－—–~～]/g, '-')
      .toLowerCase();
  }

  /** 标准答案可能写成 “样本容量（样本规模）”，括号内为等价说法 */
  function expandAlts(ans) {
    const out = [];
    const raw = String(ans || '').trim();
    if (!raw) return out;
    out.push(raw);
    const m = raw.match(/^(.*?)[（(]([^（）()]*)[）)]\s*$/);
    if (m) {
      const main = m[1].trim();
      const alt = m[2].trim();
      if (main) out.push(main);
      if (alt) out.push(alt);
      // “可靠性（稳定性）” 之外还有 “大于或小于（＞、＜）” 这类符号等价
      alt.split(/[、,，;；]/).forEach(x => { if (x.trim()) out.push(x.trim()); });
    }
    return Array.from(new Set(out.filter(Boolean)));
  }

  /** 判分：规范化后必须完全一致（别名由 expandAlts 展开）；少打多打一个字都算错 */
  function checkBlank(user, standard) {
    const u = normText(user);
    if (!u) return false;
    return expandAlts(standard).some(a => {
      const n = normText(a);
      return n && n === u;
    });
  }

  /* ---------------- 队列 ---------------- */
  function roundRobinByType(list) {
    const groups = new Map();
    list.forEach(q => {
      if (!groups.has(q.type)) groups.set(q.type, []);
      groups.get(q.type).push(q);
    });
    const keys = Array.from(groups.keys());
    const out = [];
    let i = 0, more = true;
    while (more) {
      more = false;
      for (const k of keys) {
        const g = groups.get(k);
        if (i < g.length) { out.push(g[i]); more = true; }
      }
      i++;
    }
    return out;
  }

  function interleave(a, b, ratioA) {
    const out = [];
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      for (let k = 0; k < ratioA && i < a.length; k++) out.push(a[i++]);
      if (j < b.length) out.push(b[j++]);
    }
    return out;
  }

  function buildQueue(type, opts) {
    opts = opts || {};
    const today = Scheduler.todayStr();
    const st = Store.state;
    const shuf = opts.shuffle != null ? opts.shuffle : shuffleOn();
    const pool = Bank.all.filter(q =>
      (type === 'all' || q.type === type) && (!opts.chapter || q.chapter === opts.chapter));

    if (opts.wrongOnly) {
      const arr = pool.filter(q => {
        const s = Store.peek(q.id);
        return s && (s.wrong || 0) > 0 && !Scheduler.isMastered(s);
      });
      if (shuf) return shuffledArr(arr).map(q => q.id);
      arr.sort((a, b) => (Store.peek(b.id).wrong || 0) - (Store.peek(a.id).wrong || 0) || a.no - b.no);
      return arr.map(q => q.id);
    }

    if (opts.starOnly) {
      const arr = pool.filter(q => {
        const s = Store.peek(q.id);
        return s && s.star;
      });
      if (shuf) return shuffledArr(arr).map(q => q.id);
      // 收藏夹内按到期优先，未到期按题号
      arr.sort((a, b) => {
        const sa = Store.peek(a.id), sb = Store.peek(b.id);
        const da = Scheduler.isDue(sa, today) ? 0 : 1;
        const db = Scheduler.isDue(sb, today) ? 0 : 1;
        return da - db || a.no - b.no;
      });
      return arr.map(q => q.id);
    }

    const due = [], fresh = [];
    for (const q of pool) {
      const s = Store.peek(q.id);
      if (!Scheduler.isLearned(s)) fresh.push(q);
      else if (Scheduler.isDue(s, today)) due.push(q);
    }
    due.sort((a, b) => String(Store.peek(a.id).due || '9999').localeCompare(String(Store.peek(b.id).due || '9999')));

    const day = st.daily[today] || { answered: 0, newCount: 0 };
    const newQuota = Math.max(0, (st.settings.newPerDay || 0) - (day.newCount || 0));
    const revQuota = Math.max(0, (st.settings.reviewPerDay || 0) - (day.answered || 0));

    const dueSel = due.slice(0, revQuota);
    const freshSel = fresh.slice(0, newQuota);

    const objFresh = freshSel.filter(q => q.type === 'single' || q.type === 'judge' || q.type === 'blank');
    const subFresh = freshSel.filter(q => q.type === 'short' || q.type === 'prac');
    const freshOrdered = roundRobinByType(objFresh).concat(roundRobinByType(subFresh));

    const out = interleave(dueSel, freshOrdered, 2);
    return (shuf ? shuffledArr(out) : out).map(q => q.id);
  }

  /** 按当前工具栏状态重建本轮练习（切换顺序、进出错题/收藏模式都走这里） */
  function replay(mut) {
    const opts = { chapter: App.chapter, wrongOnly: App.wrongMode, starOnly: App.starMode };
    if (mut) mut(opts);
    startSession(App.filter, opts);
  }

  function syncToolbar() {
    qsa('#typeChips .chip').forEach(c => c.classList.toggle('is-on', c.dataset.type === App.filter));
    qs('#btnWrongMode').classList.toggle('on', App.wrongMode);
    qs('#btnStarMode').classList.toggle('on', App.starMode);
    const ob = qs('#btnOrder');
    if (ob) {
      const sh = shuffleOn();
      ob.textContent = sh ? '乱序' : '顺序';
      ob.classList.toggle('on', sh);
      ob.title = sh ? '当前：乱序练习（点击改为按顺序）' : '当前：按顺序练习（点击改为乱序）';
    }
  }

  function startSession(type, opts) {
    opts = opts || {};
    App.filter = type;
    App.wrongMode = !!opts.wrongOnly;
    App.starMode = !!opts.starOnly;
    App.chapter = opts.chapter || '';
    const ids = buildQueue(type, opts);
    App.session = { queue: ids, pos: 0, initial: ids.length, extra: !!opts.extra };
    App.requeue = {};
    App.wrongStreak = {};
    App.seen = new Set();
    clearAuto();
    syncToolbar();
    updateChapterUI();
    updateProgressLine();
    nextQuestion();
  }

  function updateChapterUI() {
    const sel = qs('#chapterSelect');
    if (!sel) return;
    const on = App.filter === 'short';
    sel.hidden = !on;
    if (!on) return;
    if (!sel.dataset.filled) {
      const chs = Array.from(new Set(
        Bank.all.filter(q => q.type === 'short' && q.chapter).map(q => q.chapter)
      )).sort((a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0));
      sel.innerHTML = '<option value="">全部章节</option>' +
        chs.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
      sel.dataset.filled = '1';
    }
    sel.value = App.chapter || '';
  }

  function nextQuestion() {
    const s = App.session;
    if (!s) return;
    clearAuto();
    while (s.pos < s.queue.length) {
      const id = s.queue[s.pos++];
      const q = Bank.byId[id];
      if (q) {
        if (!App.seen) App.seen = new Set();
        App.seen.add(id);
        renderQuestion(q);
        return;
      }
    }
    renderEmpty();
  }

  function renderEmpty() {
    qs('#qbody').hidden = true;
    qs('#emptyState').hidden = false;
    qs('#btnNext').hidden = true;
    qs('#hint').hidden = true;
    const pool = Bank.all.filter(q => App.filter === 'all' || q.type === App.filter);
    const allFresh = pool.every(q => !Scheduler.isLearned(Store.peek(q.id)));
    const h3 = qs('#emptyState').querySelector('h3');
    const p = qs('#emptyState').querySelector('p');
    if (App.starMode) {
      h3.textContent = '收藏夹里没有题目';
      p.textContent = '练习或题库页点击题目右上角的 ☆ 收藏，之后就能在这里单独复习。';
    } else if (App.wrongMode) {
      h3.textContent = '本轮错题强化完成';
      p.textContent = '每道错题都连续答对 ' + WRONG_PASS_NEED + ' 次才算过。可以再来一组，或回普通练习继续推进度。';
    } else {
      h3.textContent = allFresh ? '这个题型已经练完一轮' : '今天的任务已完成';
      p.textContent = allFresh
        ? '该范围没有剩余新题，可切换题型或继续巩固错题。'
        : '没有到期需要复习的题目了。可以切换题型，或额外加练 10 道。';
    }
    const extra = qs('#btnExtra');
    extra.hidden = App.starMode;
    extra.textContent = App.wrongMode ? '再练 10 道错题' : '再来 10 题';
    updateProgressLine();
  }

  /* ---------------- 渲染题目 ---------------- */
  function renderQuestion(q) {
    App.current = q;
    App.answered = false;

    const card = qs('#qcard');
    qs('#qbody').hidden = false;
    qs('#emptyState').hidden = true;
    qs('#feedback').hidden = true;
    qs('#btnNext').hidden = true;
    qs('#hint').hidden = false;

    // 题头
    const badge = qs('#qType');
    badge.textContent = TYPE_SHORT[q.type];
    badge.className = 'badge t-' + q.type;
    qs('#qNo').textContent = '第 ' + q.no + ' 题';
    qs('#qChapter').textContent = q.chapter || '';

    const s = Store.peek(q.id);
    const dot = qs('#qState');
    dot.className = 'streak-dot' + (s && Scheduler.isLearned(s) ? ' lv' + Scheduler.level(s) : '');
    dot.title = !s || !Scheduler.isLearned(s) ? '未练习'
      : (Scheduler.isMastered(s) ? '已掌握（间隔 ' + s.interval + ' 天）'
        : '练习 ' + (s.reps || 0) + ' 次，正确 ' + (s.right || 0) + ' 次，错误 ' + (s.wrong || 0) + ' 次');

    const star = qs('#btnStar');
    const on = !!(s && s.star);
    star.classList.toggle('on', on);
    star.textContent = on ? '★' : '☆';

    // 笔记
    const hasNote = !!(s && s.note && s.note.trim());
    const nb = qs('#btnNote');
    nb.classList.toggle('on', hasNote);
    nb.title = hasNote ? '编辑笔记（N）' : '记笔记（N）';
    qs('#noteBox').hidden = true;

    renderStem(q);
    renderAnswerArea(q);

    qs('#hint').innerHTML = hintFor(q.type);

    card.classList.remove('enter');
    void card.offsetWidth;
    card.classList.add('enter');

    focusFirstBlank();
  }

  /**
   * 填空题渲染完就把光标放进第一个空：换题后可以直接打字，不必先用鼠标点。
   * 用下一帧聚焦 —— 此刻卡片还在播 enter 动画，立即 focus 会让页面被滚一下；
   * preventScroll 再兜一层，长题干时也不会跳动。
   */
  function focusFirstBlank() {
    const inp = qs('#qStem .blank-input');
    if (!inp) return;
    requestAnimationFrame(() => {
      if (!App.current || App.current.type !== 'blank' || App.answered) return;
      if (document.activeElement === inp) return;
      inp.focus({ preventScroll: true });
      inp.setSelectionRange(inp.value.length, inp.value.length);
    });
  }

  function hintFor(type) {
    if (type === 'single') return '按 <kbd>1</kbd>–<kbd>4</kbd> 选择 A–D';
    if (type === 'judge') return '按 <kbd>1</kbd> 判正确 · <kbd>2</kbd> 判错误';
    if (type === 'blank') return '填写后按 <kbd>Enter</kbd> 提交';
    return '先默想，再按 <kbd>Space</kbd> 看答案';
  }

  function renderStem(q) {
    const box = qs('#qStem');
    box.innerHTML = '';

    if (q.type === 'prac') {
      const t = document.createElement('div');
      t.className = 'q-title';
      t.textContent = '【' + q.kind + '】' + q.title + (q.score ? '　·　' + q.score : '');
      box.appendChild(t);
    }

    if (q.type === 'blank') {
      const parts = q.stem.split(/[＿_]{2,}/);
      parts.forEach((p, i) => {
        if (p) box.appendChild(document.createTextNode(p));
        if (i < parts.length - 1) {
          const inp = document.createElement('input');
          inp.className = 'blank-input';
          inp.type = 'text';
          inp.dataset.idx = String(i);
          inp.placeholder = '第 ' + (i + 1) + ' 空';
          inp.autocomplete = 'off';
          const std = q.blanks[i] || '';
          inp.style.width = Math.max(92, Math.min(260, std.length * 20 + 44)) + 'px';
          box.appendChild(inp);
        }
      });
    } else {
      box.appendChild(document.createTextNode(q.stem));
    }
  }

  function renderAnswerArea(q) {
    const area = qs('#answerArea');
    area.innerHTML = '';

    if (q.type === 'single') {
      const wrap = document.createElement('div');
      wrap.className = 'options';
      q.options.forEach(o => {
        const b = document.createElement('button');
        b.className = 'opt';
        b.dataset.act = 'pick';
        b.dataset.k = o.key;
        b.innerHTML = '<span class="k">' + esc(o.key) + '</span><span class="t">' + esc(o.text) + '</span>';
        wrap.appendChild(b);
      });
      area.appendChild(wrap);
      return;
    }

    if (q.type === 'judge') {
      const wrap = document.createElement('div');
      wrap.className = 'judge-row';
      [['√', '正确'], ['×', '错误']].forEach(([v, label]) => {
        const b = document.createElement('button');
        b.className = 'judge-btn';
        b.dataset.act = 'judge';
        b.dataset.v = v;
        b.innerHTML = esc(v) + '<span>' + label + '</span>';
        wrap.appendChild(b);
      });
      area.appendChild(wrap);
      return;
    }

    if (q.type === 'blank') {
      const btn = document.createElement('button');
      btn.className = 'primary-btn';
      btn.dataset.act = 'submit-blank';
      btn.textContent = '提交答案';
      const wrap = document.createElement('div');
      wrap.style.marginTop = '6px';
      wrap.appendChild(btn);
      area.appendChild(wrap);
      return;
    }

    // 主观题
    if (q.table && q.table.length) {
      area.appendChild(buildTable(q.table));
    }
    const ph = document.createElement('div');
    ph.className = 'answer-hidden';
    ph.id = 'ansHidden';
    ph.textContent = q.type === 'short' ? '先在心里或纸上作答，再展开参考答案' : '先自己列要点，再展开参考答案';
    area.appendChild(ph);

    const btn = document.createElement('button');
    btn.className = 'primary-btn';
    btn.dataset.act = 'show-answer';
    btn.style.marginTop = '14px';
    btn.textContent = '显示参考答案';
    area.appendChild(btn);
  }

  function buildTable(rows) {
    const wrap = document.createElement('div');
    wrap.style.overflowX = 'auto';
    const tb = document.createElement('table');
    tb.className = 'qtable';
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      r.forEach(c => {
        const cell = document.createElement(i === 0 ? 'th' : 'td');
        cell.textContent = c;
        tr.appendChild(cell);
      });
      tb.appendChild(tr);
    });
    wrap.appendChild(tb);
    return wrap;
  }

  /* ---------------- 判分与记录 ---------------- */
  function showFeedback(ok, html) {
    const f = qs('#feedback');
    f.className = 'feedback ' + (ok ? 'ok' : 'no');
    f.innerHTML = html;
    // 反馈是多行（判定 / 正确答案 / 逐空对照 / 提示），一律纵向排列
    f.classList.add('col');
    f.hidden = false;
    // 窗口矮的时候反馈会落到可视区外，用户就「看不到正确答案」，这里拉回视野
    const r = f.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 8 || r.top < 0) {
      f.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * 答对自动跳下一题（留一点停顿）；答错只亮出按钮，等用户自己翻。
   * @param {boolean} correct 是否答对
   * @param {number} [delay] 停顿毫秒数，默认按题型取
   */
  function markNext(correct, delay) {
    const btn = qs('#btnNext');
    btn.hidden = false;
    qs('#hint').hidden = true;
    clearAuto();
    const auto = !!correct && autoNextOn();
    if (!auto) {
      btn.removeAttribute('data-auto');
      btn.title = '';
      return;
    }
    const ms = delay || (App.current && App.current.type === 'blank' ? AUTO_NEXT_DELAY_BLANK : AUTO_NEXT_DELAY);
    btn.dataset.auto = '1';
    btn.style.setProperty('--auto-delay', ms + 'ms');
    btn.title = '答对了，' + (ms / 1000).toFixed(1) + ' 秒后自动进入下一题（也可立即点击或按 Enter）';
    startAutoCountdown(btn, ms);
    App.autoTimer = setTimeout(() => {
      App.autoTimer = null;
      nextQuestion();
    }, ms);
  }

  function autoTip(tail) {
    if (!autoNextOn()) return tail || '';
    return '稍后自动进入下一题';
  }

  /** 答对时提示「N 秒后自动进入下一题」，是反馈条里独立的一行 */
  function autoTipLine(ms) {
    const sec = ((ms || AUTO_NEXT_DELAY) / 1000).toFixed(1);
    if (!autoNextOn()) return '<div class="fb-tip">按 Enter 或点「下一题」继续</div>';
    return '<div class="fb-tip">' + sec + ' 秒后自动进入下一题</div>';
  }

  /** 答错时不自动跳，明确告诉用户要手动翻 */
  function wrongTipLine() {
    return '<div class="fb-tip">答错不自动跳，看完正确答案后点「下一题」继续</div>';
  }

  function answerSingle(key) {
    if (App.answered) return;
    const q = App.current;
    App.answered = true;
    const correct = key === q.answer;
    qsa('#answerArea .opt').forEach(el => {
      el.disabled = true;
      const k = el.dataset.k;
      if (k === q.answer && k === key) el.classList.add('right');
      else if (k === q.answer) el.classList.add('miss');
      else if (k === key) el.classList.add('wrong');
    });
    const ansText = (q.options.find(o => o.key === q.answer) || {}).text || '';
    const ans = '正确答案　<b>' + esc(q.answer) + '．' + esc(ansText) + '</b>';
    if (correct) showFeedback(true, '<div class="fb-head">✔ 回答正确</div><div class="fb-ansline">' + ans + '</div>' + autoTipLine());
    else showFeedback(false, '<div class="fb-head">✘ 回答错误</div><div class="fb-ansline">' + ans + '</div>' + wrongTipLine());
    record(q, correct ? 4 : 0, correct);
    markNext(correct);
  }

  function answerJudge(val) {
    if (App.answered) return;
    const q = App.current;
    App.answered = true;
    const correct = val === q.answer;
    qsa('#answerArea .judge-btn').forEach(el => {
      el.disabled = true;
      const v = el.dataset.v;
      if (v === q.answer) el.classList.add('right');
      if (v === val && !correct) { el.classList.remove('right'); el.classList.add('wrong'); }
    });
    const ans = '正确答案　<b>' + (q.answer === '√' ? '√ 正确' : '× 错误') + '</b>';
    if (correct) showFeedback(true, '<div class="fb-head">✔ 回答正确</div><div class="fb-ansline">' + ans + '</div>' + autoTipLine());
    else showFeedback(false, '<div class="fb-head">✘ 回答错误</div><div class="fb-ansline">' + ans + '</div>' + wrongTipLine());
    record(q, correct ? 4 : 0, correct);
    markNext(correct);
  }

  function submitBlank() {
    if (App.answered) return;
    App.submitStamp = Date.now();   // 这一次 Enter 已经用来提交，别再被当成「下一题」
    const q = App.current;
    const inputs = qsa('#qStem .blank-input, #answerArea .blank-input');
    if (!inputs.length) return;

    const stds = (q.blanks && q.blanks.length) ? q.blanks.slice() : [q.answer];
    const orderFree = stds.length > 1;   // 多个空：只比内容集合，不认填写顺序

    // 每个标准答案只能用一次：用户把「B」填在第 1 空、把「A」填在第 2 空，仍算全对
    const pool = stds.map(s => ({ std: s, used: false }));
    const rows = inputs.map((inp, i) => {
      const typed = inp.value.trim();
      let hit = -1;
      if (typed) hit = pool.findIndex(p => !p.used && checkBlank(typed, p.std));
      if (hit >= 0) pool[hit].used = true;
      return { idx: i, typed: typed, ok: hit >= 0, matched: hit >= 0 ? pool[hit].std : '' };
    });

    App.answered = true;
    const okCount = rows.filter(r => r.ok).length;
    const allOk = okCount === rows.length;
    inputs.forEach((inp, i) => {
      inp.classList.remove('right', 'wrong');
      inp.classList.add(rows[i].ok ? 'right' : 'wrong');
      inp.disabled = true;
    });
    const sub = qs('#answerArea [data-act="submit-blank"]');
    if (sub) { sub.disabled = true; sub.textContent = '已提交'; }

    // 三件事必须说清：对错、正确答案、接下来会怎样
    const answerLine = '<div class="fb-ansline">正确答案　<b>' + esc(stds.join('；')) + '</b></div>';
    const youLine = allOk ? '' :
      '<div class="fb-ansline">你填的　' + esc(rows.map(r => r.typed || '（空）').join('；')) + '</div>';
    const missLine = (orderFree && !allOk)
      ? (() => {
          const miss = pool.filter(p => !p.used).map(p => p.std);
          return miss.length
            ? '<div class="fb-ansline">没填出的　' + esc(miss.join('；')) + '</div>'
            : '';
        })()
      : '';
    const tip = allOk ? autoTipLine(AUTO_NEXT_DELAY_BLANK) : wrongTipLine();
    const head = '<div class="fb-head">' + (allOk ? '✔ 回答正确' : '✘ 回答错误') +
      (allOk
        ? (orderFree ? '　<span style="opacity:.8">' + stds.length + ' 个空全部填对，顺序不限</span>' : '')
        : '　<span style="opacity:.8">' + rows.length + ' 空对了 ' + okCount + ' 空</span>') +
      '</div>';

    showFeedback(allOk, head + answerLine + youLine + missLine + tip);
    record(q, allOk ? 4 : 0, allOk);
    markNext(allOk);
  }

  /** 把长答案切成可逐句遮盖的片段：先按行，过长再按句号/分号 */
  function splitSegments(text) {
    const lines = String(text || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
    const segs = [];
    for (const line of lines) {
      if (line.length <= 110) { segs.push(line); continue; }
      const parts = line.split(/(?<=[。；;！？])/).map(s => s.trim()).filter(Boolean);
      segs.push.apply(segs, parts);
    }
    return segs.length ? segs : [String(text || '')];
  }

  function renderSegList(container, text, tools) {
    const segs = splitSegments(text);
    container.className = 'ab-body seg-mode';
    container.innerHTML = '';

    const bar = document.createElement('div');
    bar.className = 'seg-bar';
    const cnt = document.createElement('span');
    cnt.innerHTML = '已揭开 <b>0</b> / ' + segs.length;
    bar.appendChild(cnt);
    container.appendChild(bar);

    const list = document.createElement('div');
    list.className = 'seg-list';
    segs.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'seg';
      const no = document.createElement('span');
      no.className = 'seg-no';
      no.textContent = String(i + 1);
      const tx = document.createElement('span');
      tx.className = 'seg-txt';
      tx.textContent = s;
      d.appendChild(no);
      d.appendChild(tx);
      d.addEventListener('click', () => {
        d.classList.toggle('open');
        sync();
      });
      list.appendChild(d);
    });
    container.appendChild(list);

    let allOpen = false;
    const allBtn = document.createElement('button');
    allBtn.className = 'ghost-btn small-btn seg-all';
    allBtn.textContent = '全部揭开';
    if (tools) tools.appendChild(allBtn);
    allBtn.addEventListener('click', () => {
      allOpen = !allOpen;
      qsa('.seg', list).forEach(el => el.classList.toggle('open', allOpen));
      allBtn.textContent = allOpen ? '全部遮住' : '全部揭开';
      sync();
    });

    function sync() {
      const n = qsa('.seg.open', list).length;
      cnt.innerHTML = '已揭开 <b>' + n + '</b> / ' + segs.length;
    }
  }

  function showAnswer() {
    const q = App.current;
    if (q.type !== 'short' && q.type !== 'prac') return;
    const ph = qs('#ansHidden');
    if (ph) ph.remove();

    const box = document.createElement('div');
    box.className = 'answer-box';
    const head = document.createElement('div');
    head.className = 'ab-head';
    head.innerHTML = '<span class="lbl">参考答案</span>';

    const tools = document.createElement('div');
    tools.className = 'ab-tools';

    const segBtn = document.createElement('button');
    segBtn.className = 'ghost-btn small-btn';
    segBtn.textContent = '逐句背';
    segBtn.addEventListener('click', () => {
      const on = segBtn.classList.toggle('on');
      segBtn.textContent = on ? '看全文' : '逐句背';
      if (on) {
        renderSegList(body, q.answerText || '', tools);
      } else {
        body.className = 'ab-body';
        body.textContent = q.answerText || '（本题暂无参考答案）';
        const ab = tools.querySelector('.seg-all');
        if (ab) ab.remove();
      }
    });

    const spk = document.createElement('button');
    spk.className = 'ghost-btn small-btn';
    spk.textContent = '朗读';
    spk.addEventListener('click', () => {
      if (window.__speak) window.__speak(q.stem + '。' + (q.answerText || ''));
    });

    tools.appendChild(segBtn);
    tools.appendChild(spk);
    head.appendChild(tools);

    const body = document.createElement('div');
    body.className = 'ab-body';
    body.textContent = q.answerText || '（本题暂无参考答案）';
    box.appendChild(head);
    box.appendChild(body);
    qs('#answerArea').appendChild(box);

    const old = qs('#answerArea [data-act="show-answer"]');
    if (old) old.remove();

    if (!qs('#selfGrade')) {
      const wrap = document.createElement('div');
      wrap.className = 'selfgrade';
      wrap.id = 'selfGrade';
      [['0', '不会', '完全想不起来', 'g0'], ['3', '模糊', '有印象但不完整', 'g1'], ['4', '掌握', '能完整复述要点', 'g2']].forEach(([g, label, desc, cls]) => {
        const b = document.createElement('button');
        b.className = 'sg ' + cls;
        b.dataset.act = 'self-grade';
        b.dataset.g = g;
        b.innerHTML = label + '<small>' + desc + '</small>';
        wrap.appendChild(b);
      });
      qs('#answerArea').appendChild(wrap);
    }
    qs('#hint').innerHTML = '根据实际掌握程度选择，决定下次复习间隔';
    qs('#hint').hidden = false;
  }

  function selfGrade(g) {
    if (App.answered) return;
    App.answered = true;
    const q = App.current;
    const v = parseInt(g, 10);
    qsa('#selfGrade .sg').forEach(b => { b.disabled = true; });
    const label = v >= 4 ? '已记为掌握，下次间隔延长' : (v === 3 ? '已记为模糊，明天再复习' : '已记为不会，稍后再出现');
    showFeedback(v >= 4, '自评：' + (v >= 4 ? '掌握' : v === 3 ? '模糊' : '不会') + '　<span style="opacity:.75">' +
      (v >= 4 ? autoTip(label) : label) + '</span>');
    record(q, v, v >= 4);
    markNext(v >= 4);
  }

  function record(q, quality, isCorrect) {
    const st = Store.state;
    const today = Scheduler.todayStr();
    if (!st.daily[today]) st.daily[today] = { answered: 0, right: 0, newCount: 0 };
    const d = st.daily[today];
    const s0 = Store.peek(q.id);
    const wasNew = !Scheduler.isLearned(s0);

    d.answered += 1;
    if (isCorrect) d.right += 1;
    if (wasNew) d.newCount = (d.newCount || 0) + 1;

    st.meta.totalAnswered = (st.meta.totalAnswered || 0) + 1;
    if (isCorrect) st.meta.totalRight = (st.meta.totalRight || 0) + 1;

    Scheduler.grade(q.id, quality);
    updateStreak();
    Store.save();

    if (App.wrongMode && App.session) {
      // 错题强化：连续答对 WRONG_PASS_NEED 次才移出本轮；答错清零，重排到队尾再考
      const n = isCorrect ? (App.wrongStreak[q.id] || 0) + 1 : 0;
      App.wrongStreak[q.id] = n;
      App.requeue[q.id] = (App.requeue[q.id] || 0) + 1;
      if ((!isCorrect || n < WRONG_PASS_NEED) && App.requeue[q.id] <= REQUEUE_MAX) {
        App.session.queue.push(q.id);
      }
    } else if (quality < 4 && st.settings.requeue) {
      App.requeue[q.id] = (App.requeue[q.id] || 0) + 1;
      if (App.requeue[q.id] <= 1 && App.session) {
        App.session.queue.push(q.id);
      }
    }
    updateTopStats();
    updateProgressLine();
  }

  function updateStreak() {
    const today = Scheduler.todayStr();
    const m = Store.state.meta;
    if (m.streakLast === today) return;
    if (m.streakLast && Scheduler.diffDays(today, m.streakLast) === 1) m.streakDays = (m.streakDays || 0) + 1;
    else m.streakDays = 1;
    m.streakLast = today;
  }

  /* ---------------- 笔记 ---------------- */
  function openNote() {
    if (!App.current) return;
    const s = Store.peek(App.current.id);
    qs('#noteInput').value = (s && s.note) || '';
    qs('#noteTip').textContent = 'Ctrl + Enter 保存';
    qs('#noteBox').hidden = false;
    setTimeout(() => qs('#noteInput').focus(), 30);
  }

  function closeNote() {
    qs('#noteBox').hidden = true;
  }

  function saveNote() {
    if (!App.current) return;
    const v = qs('#noteInput').value.trim();
    const s = Store.q(App.current.id);
    s.note = v;
    Store.save();
    qs('#btnNote').classList.toggle('on', !!v);
    qs('#noteTip').textContent = v ? '已保存' : '已清空';
    toast(v ? '笔记已保存' : '笔记已清除');
  }

  /* ---------------- 主题 ---------------- */
  function resolveTheme(mode) {
    if (mode === 'auto') {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return mode === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(mode, persist) {
    const m = mode === 'dark' || mode === 'auto' ? mode : 'light';
    const eff = resolveTheme(m);
    document.documentElement.dataset.theme = eff;
    document.documentElement.dataset.themeMode = m;
    if (persist && Store.state) {
      Store.state.settings.theme = m;
      Store.save(true);
    }
    // 供下次启动的首帧使用（进度文件异步读取，来不及）
    try { localStorage.setItem('ssq-theme', m); } catch (e) { /* 忽略 */ }
    const btn = qs('#btnTheme');
    if (btn) {
      btn.textContent = m === 'auto' ? '◑' : (m === 'dark' ? '☾' : '☀');
      btn.title = '外观：' + (m === 'auto' ? '跟随系统' : m === 'dark' ? '深色' : '浅色');
    }
    qsa('#themePick [data-theme]').forEach(b => b.classList.toggle('is-on', b.dataset.theme === m));
  }

  function cycleTheme() {
    const cur = (Store.state.settings.theme) || 'light';
    const next = cur === 'light' ? 'dark' : cur === 'dark' ? 'auto' : 'light';
    applyTheme(next, true);
    toast('外观：' + (next === 'auto' ? '跟随系统' : next === 'dark' ? '深色' : '浅色'));
  }

  /* ---------------- 顶栏与进度 ---------------- */
  function updateTopStats() {
    const today = Scheduler.todayStr();
    const st = Store.state;
    const day = st.daily[today] || { answered: 0 };
    const goal = Math.max(10, parseInt(st.settings.dailyGoal, 10) || 50);
    const done = day.answered || 0;
    let dueCount = 0;
    for (const q of Bank.all) {
      if (Scheduler.isDue(Store.peek(q.id), today)) dueCount++;
    }
    qs('#tsToday').textContent = done;
    qs('#tsGoal').textContent = '/ ' + goal;
    qs('#tsToday').classList.toggle('goal-done', done >= goal);
    qs('#tsDue').textContent = dueCount;
    qs('#tsStreak').textContent = st.meta.streakDays || 0;
    qs('#tsDue').parentElement.classList.toggle('hot', dueCount > 0);

    if (done >= goal && App.goalHit !== today) {
      App.goalHit = today;
      if (done > 0) toast('今日目标已达成 ' + done + ' / ' + goal + ' 题');
    }
  }

  function updateProgressLine() {
    const s = App.session;
    const day = Store.state.daily[Scheduler.todayStr()] || { answered: 0 };
    const remain = s ? Math.max(0, s.queue.length - s.pos) : 0;

    const label = qs('#plLabel');
    if (label) {
      label.textContent = App.wrongMode ? '错题强化' : App.starMode ? '收藏练习'
        : (s && s.extra ? '额外加练' : '今日进度');
    }

    // 错题强化的队列会因为「没过关」变长，进度按「已过 / 当前队列」算
    if (App.wrongMode) {
      qs('#plNum').textContent = remain ? '剩余 ' + remain + ' 题' : '本轮完成';
      const len = s ? s.queue.length : 0;
      qs('#plBar').style.width = len ? Math.min(100, ((len - remain) / len) * 100) + '%' : '0%';
      return;
    }

    const done = day.answered || 0;
    const total = done + remain;
    qs('#plNum').textContent = done + ' / ' + total;
    qs('#plBar').style.width = total ? Math.min(100, (done / total) * 100) + '%' : '0%';
  }

  /* ---------------- 题库浏览 ---------------- */
  function renderBrowse() {
    const kw = normText(qs('#searchInput').value);
    const onlyWrong = qs('#onlyWrong').checked;
    const onlyStar = qs('#onlyStar').checked;
    const type = App.browseType;

    const rows = Bank.all.filter(q => {
      if (type !== 'all' && q.type !== type) return false;
      if (onlyWrong) {
        const s = Store.peek(q.id);
        if (!s || !(s.wrong > 0)) return false;
      }
      if (onlyStar) {
        const s = Store.peek(q.id);
        if (!s || !s.star) return false;
      }
      if (kw) {
        const hay = normText(q.stem + ' ' + (q.answerText || '') + ' ' + (q.answer || '') + ' ' +
          (q.options || []).map(o => o.text).join(' ') + ' ' + (q.blanks || []).join(' ') + ' ' +
          ((Store.peek(q.id) || {}).note || ''));
        if (!hay.includes(kw)) return false;
      }
      return true;
    });

    const tags = [];
    if (onlyWrong) tags.push('错题');
    if (onlyStar) tags.push('收藏');
    if (kw) tags.push('关键词「' + qs('#searchInput').value + '」');
    qs('#browseMeta').textContent = '共 ' + rows.length + ' 题' + (tags.length ? '（' + tags.join(' · ') + '）' : '');
    const list = qs('#browseList');
    list.innerHTML = '';
    const frag = document.createDocumentFragment();

    rows.forEach(q => {
      const s = Store.peek(q.id);
      const item = document.createElement('div');
      item.className = 'item';
      item.dataset.id = q.id;

      const flags = [];
      if (s && s.star) flags.push('<span class="flag">收藏</span>');
      if (s && s.note && s.note.trim()) flags.push('<span class="flag note">笔记</span>');
      if (s && s.wrong > 0) flags.push('<span class="flag warn">错 ' + s.wrong + '</span>');
      if (s && s.recite && s.recite.rounds) flags.push('<span class="flag rec">背 ' + s.recite.rounds + '</span>');
      if (s && Scheduler.isMastered(s)) flags.push('<span class="flag ok">已掌握</span>');

      const head = document.createElement('div');
      head.className = 'item-head';
      head.innerHTML =
        '<span class="badge t-' + q.type + '">' + TYPE_SHORT[q.type] + '</span>' +
        '<div class="item-stem"><span class="dim">' + q.no + '.</span>' + esc(q.stem.slice(0, 90)) + (q.stem.length > 90 ? '…' : '') + '</div>' +
        '<div class="item-flags">' + flags.join('') + '</div>';

      const body = document.createElement('div');
      body.className = 'item-body';
      body.innerHTML = buildItemBody(q, q.stem.length > 90, s);

      item.appendChild(head);
      item.appendChild(body);
      frag.appendChild(item);
    });

    list.appendChild(frag);
  }

  function buildItemBody(q, needFullStem, s) {
    let html = needFullStem ? '<div style="white-space:pre-wrap;color:var(--ink2)">' + esc(q.stem) + '</div>' : '';
    if (q.type === 'single' && q.options) {
      html += q.options.map(o =>
        '<div class="opt-line' + (o.key === q.answer ? ' correct' : '') + '"><b>' + esc(o.key) + '．</b>' + esc(o.text) + '</div>'
      ).join('');
      html += '<div class="ans-line">答案：' + esc(q.answer) + '　' + esc((q.options.find(o => o.key === q.answer) || {}).text || '') + '</div>';
    } else if (q.type === 'judge') {
      html += '<div class="ans-line">答案：' + (q.answer === '√' ? '√ 正确' : '× 错误') + '</div>';
    } else if (q.type === 'blank') {
      html += '<div class="ans-line">答案：' + esc(q.answer) + '</div>';
    } else {
      if (q.table && q.table.length) {
        html += '<div style="overflow-x:auto;margin-top:10px"><table class="qtable">' +
          q.table.map((r, i) => '<tr>' + r.map(c => '<' + (i === 0 ? 'th' : 'td') + '>' + esc(c) + '</' + (i === 0 ? 'th' : 'td') + '>').join('') + '</tr>').join('') +
          '</table></div>';
      }
      html += '<div class="ans-line">参考答案：\n' + esc(q.answerText || '（无）') + '</div>';
    }
    if (s && s.note && s.note.trim()) {
      html += '<div class="item-note"><b>笔记</b><span>' + esc(s.note) + '</span></div>';
    }
    html += '<div class="item-actions"><button class="ghost-btn small-btn" data-practice="' + q.id + '">练这题</button></div>';
    return html;
  }

  /** 从题库直接进入单题练习 */
  function practiceOne(id) {
    const q = Bank.byId[id];
    if (!q) return;
    App.filter = q.type;
    App.chapter = '';
    App.wrongMode = false;
    App.starMode = false;
    App.requeue = {};
    App.wrongStreak = {};
    App.seen = new Set([id]);
    clearAuto();
    App.session = { queue: [id], pos: 1, initial: 1 };
    syncToolbar();
    updateChapterUI();
    switchView('practice');
    renderQuestion(q);
    updateProgressLine();
  }

  /* ---------------- 统计 ---------------- */
  function renderStats() {
    const st = Store.state;
    const today = Scheduler.todayStr();
    let learned = 0, mastered = 0;
    const perType = {};
    Object.keys(TYPE_SHORT).forEach(t => { perType[t] = { total: 0, learned: 0, mastered: 0 }; });

    Bank.all.forEach(q => {
      const s = Store.peek(q.id);
      const p = perType[q.type];
      if (p) p.total++;
      if (Scheduler.isLearned(s)) {
        learned++;
        if (p) p.learned++;
        if (Scheduler.isMastered(s)) { mastered++; if (p) p.mastered++; }
      }
    });

    const day = st.daily[today] || { answered: 0, right: 0 };
    qs('#kpiLearned').textContent = learned;
    qs('#kpiMastered').textContent = mastered;
    qs('#kpiAcc').textContent = day.answered ? Math.round((day.right / day.answered) * 100) + '%' : '—';
    qs('#kpiTotal').textContent = st.meta.totalAnswered || 0;

    // 题型进度
    const rows = qs('#typeRows');
    rows.innerHTML = '';
    Object.keys(TYPE_SHORT).forEach(t => {
      const p = perType[t];
      const row = document.createElement('div');
      row.className = 'trow';
      const pw = p.total ? (p.learned ? Math.max(1.4, (p.learned / p.total) * 100) : 0) : 0;
      const mw = p.total ? (p.mastered ? Math.max(1.4, (p.mastered / p.total) * 100) : 0) : 0;
      row.innerHTML =
        '<div class="tname">' + TYPE_SHORT[t] + '</div>' +
        '<div class="tbar"><i class="seg-learn" style="width:' + pw + '%"></i><i class="seg-master" style="width:' + mw + '%"></i></div>' +
        '<div class="tnum">' + p.mastered + ' / ' + p.total + '</div>';
      rows.appendChild(row);
    });

    // 背题覆盖
    const rs = qs('#reciteSum');
    if (rs) {
      let covered = 0, rounds = 0, rpass = 0, rfail = 0, rfuzzy = 0;
      Bank.all.forEach(q => {
        const s = Store.peek(q.id);
        const r = s && s.recite;
        if (!r) return;
        covered++;
        rounds += r.rounds || 0;
        rpass += r.pass || 0;
        rfuzzy += r.fuzzy || 0;
        rfail += r.fail || 0;
      });
      rs.innerHTML =
        '<div><span>已背过</span><b>' + covered + '<em>/ ' + Bank.all.length + '</em></b></div>' +
        '<div><span>累计遍数</span><b>' + rounds + '<em>遍</em></b></div>' +
        '<div><span>会了</span><b class="ok">' + rpass + '</b></div>' +
        '<div><span>模糊</span><b>' + rfuzzy + '</b></div>' +
        '<div><span>不会</span><b class="bad">' + rfail + '</b></div>';
      const pc = Bank.all.length ? Math.round((covered / Bank.all.length) * 100) : 0;
      qs('#reciteBar').style.width = pc + '%';
      qs('#reciteNote').textContent = covered
        ? '覆盖 ' + pc + '% 的题库 · 平均每题背过 ' + (rounds / covered).toFixed(1) + ' 遍'
        : '还没有背题记录。去「背题」页一屏一题地过一遍，这里会显示覆盖情况。';
    }

    // 未来 7 天
    const chart = qs('#dueChart');
    chart.innerHTML = '';
    const buckets = [];
    for (let i = 0; i < 7; i++) buckets.push({ date: Scheduler.addDays(today, i), n: 0 });
    Bank.all.forEach(q => {
      const s = Store.peek(q.id);
      if (!Scheduler.isLearned(s)) return;
      const idx = buckets.findIndex(b => b.date === s.due);
      if (idx >= 0) buckets[idx].n++;
    });
    const maxN = Math.max(1, ...buckets.map(b => b.n));
    buckets.forEach((b, i) => {
      const col = document.createElement('div');
      col.className = 'bar-col';
      const h = b.n ? Math.max(6, (b.n / maxN) * 100) : 0;
      col.innerHTML =
        '<div class="bar-val">' + (b.n || '') + '</div>' +
        '<div class="bar-wrap"><div class="bar' + (b.n ? '' : ' zero') + '" style="height:' + (b.n ? h : 2) + '%"></div></div>' +
        '<div class="bar-lab">' + (i === 0 ? '今天' : b.date.slice(5)) + '</div>';
      chart.appendChild(col);
    });

    // 打字成绩趋势
    const trend = qs('#typingTrend');
    if (trend) {
      const logs = (st.typingLog || []).slice(-12);
      if (!logs.length) {
        trend.innerHTML = '<div class="muted" style="font-size:13px">还没有打字训练记录，去「打字」页练一篇试试</div>';
      } else {
        trend.innerHTML = logs.map(l =>
          '<div class="tr-col">' +
          '<div class="tr-val">' + l.score + '</div>' +
          '<div class="tr-wrap"><div class="tr-bar" style="height:' + Math.max(3, l.score) + '%"></div></div>' +
          '<div class="tr-lab">' + esc((l.at || '').slice(5)) + '</div>' +
          '</div>'
        ).join('');
      }
    }

    // 学习热力图（最近 12 周）
    const heat = qs('#heatGrid');
    if (heat) {
      const cells = [];
      let activeDays = 0, totalActs = 0;
      for (let i = 83; i >= 0; i--) {
        const d = Scheduler.addDays(today, -i);
        const day = st.daily[d] || {};
        const n = (day.answered || 0) + Math.round((day.typed || 0) / 60) + (day.exams || 0) * 5 + Math.round((day.recited || 0) / 3);
        if (n > 0) { activeDays++; totalActs += n; }
        const lv = n >= 31 ? 'l4' : n >= 16 ? 'l3' : n >= 6 ? 'l2' : n >= 1 ? 'l1' : '';
        cells.push('<i class="' + lv + '" title="' + d + '：' + n + (n ? ' 次练习' : '') + '"></i>');
      }
      heat.innerHTML = cells.join('');
      const hs = qs('#heatSummary');
      if (hs) hs.textContent = '近 12 周练习 ' + activeDays + ' 天 · 累计 ' + totalActs + ' 次';
    }

    // 薄弱题
    const weak = Bank.all
      .map(q => ({ q, s: Store.peek(q.id) }))
      .filter(x => x.s && x.s.wrong > 0 && !Scheduler.isMastered(x.s))
      .sort((a, b) => (b.s.wrong || 0) - (a.s.wrong || 0))
      .slice(0, 20);

    const wl = qs('#weakList');
    wl.innerHTML = '';
    if (!weak.length) {
      wl.innerHTML = '<div style="font-size:13px;color:var(--ink3);padding:6px 2px">还没有错题记录</div>';
    } else {
      weak.forEach(({ q, s }) => {
        const d = document.createElement('div');
        d.className = 'weak-item';
        d.dataset.id = q.id;
        d.innerHTML =
          '<span class="badge t-' + q.type + '">' + TYPE_SHORT[q.type] + '</span>' +
          '<div class="wtxt">' + q.no + '. ' + esc(q.stem.slice(0, 70)) + '</div>' +
          '<span class="wcnt">错 ' + s.wrong + '</span>';
        wl.appendChild(d);
      });
    }
  }

  /* ---------------- 设置 ---------------- */
  function applySettingsToUI() {
    const s = Store.state.settings;
    qs('#setNew').value = s.newPerDay;
    qs('#setReview').value = s.reviewPerDay;
    qs('#setRequeue').checked = !!s.requeue;
    qs('#setAutoNext').checked = s.autoNext !== false;
    qs('#setGoal').value = s.dailyGoal || 50;
    applyTheme(s.theme || 'light', false);
    fillVersion();
  }

  /** 设置页显示版本与数据目录：换包后能一眼确认自己开的是哪一版 */
  function fillVersion() {
    if (App.versionFilled) return;
    App.versionFilled = true;
    const set = (v, d) => {
      const a = qs('#appVersion'); if (a) a.textContent = v;
      const b = qs('#appDataDir'); if (b) b.textContent = d;
      const c = qs('#brandVer'); if (c) c.textContent = v;
    };
    if (window.desktopAPI && window.desktopAPI.info) {
      window.desktopAPI.info().then(i => {
        set('v' + i.version, i.userData);
        notifyUpdate(i.version);
      }).catch(() => set('开发模式', '—'));
    } else {
      set('开发模式', '—');
    }
  }

  /** 换到新版本后第一次打开时提示一次，之后不再打扰 */
  function notifyUpdate(ver) {
    const s = Store.state.settings;
    if (!ver || s.seenVersion === ver) return;
    s.seenVersion = ver;
    Store.save();
    setTimeout(() => toast('已更新到 v' + ver + '　填空换题后可直接打字，无需点输入框'), 800);
  }

  function bindSettings() {
    qs('#setNew').addEventListener('change', e => {
      Store.state.settings.newPerDay = Math.max(0, Math.min(200, parseInt(e.target.value, 10) || 0));
      Store.save(true);
      toast('已保存：每天新题 ' + Store.state.settings.newPerDay + ' 道');
    });
    qs('#setReview').addEventListener('change', e => {
      Store.state.settings.reviewPerDay = Math.max(0, Math.min(400, parseInt(e.target.value, 10) || 0));
      Store.save(true);
      toast('已保存：每天复习 ' + Store.state.settings.reviewPerDay + ' 道');
    });
    qs('#setRequeue').addEventListener('change', e => {
      Store.state.settings.requeue = e.target.checked;
      Store.save(true);
      toast(e.target.checked ? '答错后当日重现：开' : '答错后当日重现：关');
    });
    qs('#setAutoNext').addEventListener('change', e => {
      Store.state.settings.autoNext = e.target.checked;
      Store.save(true);
      toast(e.target.checked ? '答对自动下一题：开（停顿 1.5 秒，填空 2.2 秒）' : '答对自动下一题：关');
    });

    qs('#setGoal').addEventListener('change', e => {
      const v = Math.max(10, Math.min(400, parseInt(e.target.value, 10) || 50));
      Store.state.settings.dailyGoal = v;
      e.target.value = v;
      Store.save(true);
      updateTopStats();
      toast('每日目标：' + v + ' 题');
    });

    qs('#themePick').addEventListener('click', e => {
      const b = e.target.closest('[data-theme]');
      if (!b) return;
      applyTheme(b.dataset.theme, true);
      toast('外观：' + (b.dataset.theme === 'auto' ? '跟随系统' : b.dataset.theme === 'dark' ? '深色' : '浅色'));
    });

    qs('#btnTheme').addEventListener('click', cycleTheme);

    qs('#btnExport').addEventListener('click', () => {
      const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '社会调查题库进度_' + Scheduler.todayStr() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      toast('进度已导出');
    });

    qs('#btnExportWrong').addEventListener('click', () => {
      const wrong = Bank.all.filter(q => {
        const s = Store.peek(q.id);
        return s && (s.wrong || 0) > 0;
      });
      if (!wrong.length) { toast('还没有错题，先去练习吧'); return; }

      const groupName = { single: '单项选择', judge: '判断题', blank: '填空题', short: '名词解释 / 简答', prac: '实操题' };
      let md = '# 社会调查题库 · 错题本\n\n导出时间：' + Scheduler.todayStr() +
        '　共 ' + wrong.length + ' 题\n\n> 按错误次数排序，便于优先复习。\n';

      ['single', 'judge', 'blank', 'short', 'prac'].forEach(t => {
        const list = wrong.filter(q => q.type === t)
          .sort((a, b) => (Store.peek(b.id).wrong || 0) - (Store.peek(a.id).wrong || 0));
        if (!list.length) return;
        md += '\n## ' + groupName[t] + '（' + list.length + ' 题）\n';
        list.forEach(q => {
          md += '\n### ' + q.no + '. ' + (q.chapter ? q.chapter + ' · ' : '') +
            '错 ' + (Store.peek(q.id).wrong || 0) + ' 次\n\n';
          md += q.stem + '\n\n';
          if (q.type === 'single') {
            (q.options || []).forEach(o => { md += '- ' + o.key + '．' + o.text + '\n'; });
            const t2 = (q.options.find(o => o.key === q.answer) || {}).text || '';
            md += '\n**答案：' + q.answer + '．' + t2 + '**\n';
          } else if (q.type === 'judge') {
            md += '**答案：' + (q.answer === '√' ? '√ 正确' : '× 错误') + '**\n';
          } else if (q.type === 'blank') {
            md += '**答案：' + q.answer + '**\n';
          } else {
            md += '**参考答案：**\n\n' + (q.answerText || '（无）') + '\n';
          }
          const nt = (Store.peek(q.id) || {}).note;
          if (nt && nt.trim()) md += '\n> **我的笔记：** ' + nt.trim().replace(/\n+/g, ' ') + '\n';
        });
      });

      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '错题本_' + Scheduler.todayStr() + '.md';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      toast('已导出 ' + wrong.length + ' 道错题');
    });

    qs('#btnImport').addEventListener('click', () => qs('#fileImport').click());    qs('#fileImport').addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        await Store.importJSON(await f.text());
        applySettingsToUI();
        startSession(App.filter);
        updateTopStats();
        toast('进度已导入');
      } catch (err) {
        toast('导入失败：' + err.message);
      }
      e.target.value = '';
    });

    qs('#btnReset').addEventListener('click', () => {
      if (!confirm('确定清空全部学习进度吗？此操作不可撤销。')) return;
      Store.reset();
      applySettingsToUI();
      startSession('all');
      updateTopStats();
      toast('已重置');
    });
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindTabs() {
    qs('#tabs').addEventListener('click', e => {
      const b = e.target.closest('.tab');
      if (!b) return;
      switchView(b.dataset.view);
    });
  }

  function switchView(v) {
    App.view = v;
    if (v !== 'practice') clearAuto();
    qsa('#tabs .tab').forEach(b => b.classList.toggle('is-active', b.dataset.view === v));
    ['practice', 'recite', 'typing', 'exam', 'browse', 'stats', 'settings'].forEach(k => {
      qs('#view-' + k).hidden = k !== v;
    });
    if (v === 'recite' && window.Recite) Recite.onEnter();
    if (v === 'browse') renderBrowse();
    if (v === 'stats') renderStats();
    if (v === 'settings') applySettingsToUI();
  }

  function bindPractice() {
    qs('#typeChips').addEventListener('click', e => {
      const b = e.target.closest('.chip');
      if (!b) return;
      const type = b.dataset.type;
      const ch = type === 'short' ? App.chapter : '';
      startSession(type, { chapter: ch, wrongOnly: App.wrongMode, starOnly: App.starMode });
    });

    qs('#chapterSelect').addEventListener('change', e => {
      startSession('short', {
        chapter: e.target.value, wrongOnly: App.wrongMode, starOnly: App.starMode
      });
    });

    qs('#btnWrongMode').addEventListener('click', () => {
      replay(o => { o.wrongOnly = !App.wrongMode; });
    });

    qs('#btnStarMode').addEventListener('click', () => {
      replay(o => { o.starOnly = !App.starMode; });
    });

    // 顺序 / 乱序：全局偏好，落在 settings.shuffle，所有练习模式共用
    qs('#btnOrder').addEventListener('click', () => {
      const sh = !shuffleOn();
      Store.state.settings.shuffle = sh;
      Store.save();
      replay();
      toast(sh ? '已切换为乱序练习' : '已切换为按顺序练习');
    });

    // 笔记
    qs('#btnNote').addEventListener('click', () => {
      if (qs('#noteBox').hidden) openNote();
      else closeNote();
    });
    qs('#noteClose').addEventListener('click', closeNote);
    qs('#noteSave').addEventListener('click', saveNote);
    qs('#noteClear').addEventListener('click', () => {
      qs('#noteInput').value = '';
      saveNote();
    });
    qs('#noteInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveNote();
      }
    });

    qs('#btnNext').addEventListener('click', () => nextQuestion());

    // 额外加练：只从本轮还没出现过的题里挑，避免和刚练完的重复
    qs('#btnExtra').addEventListener('click', () => {
      const inScope = q => (App.filter === 'all' || q.type === App.filter) &&
        (!App.chapter || q.chapter === App.chapter);
      const inMode = q => {
        if (App.wrongMode) {
          const s = Store.peek(q.id);
          return !!s && (s.wrong || 0) > 0 && !Scheduler.isMastered(s);
        }
        if (App.starMode) {
          const s = Store.peek(q.id);
          return !!s && !!s.star;
        }
        return true;
      };
      const collect = () => {
        const seen = App.seen || new Set();
        return Bank.all.filter(q => inScope(q) && inMode(q) && !seen.has(q.id));
      };

      let pool = collect();
      let rested = false;
      if (!pool.length) {
        // 本范围内的题都练过了，才允许从头再来
        App.seen = new Set();
        pool = collect();
        rested = true;
      }
      if (!pool.length) {
        toast(App.wrongMode ? '没有可强化的错题了' : '这个范围没有可加练的题');
        return;
      }

      const ids = (shuffleOn() ? shuffledArr(pool) : pool).slice(0, 10).map(q => q.id);
      clearAuto();
      App.session = { queue: ids, pos: 0, initial: ids.length, extra: true };
      App.requeue = {};
      App.wrongStreak = {};
      updateProgressLine();
      nextQuestion();
      toast(rested ? '本范围已全部练过，重新开始'
        : '加练 ' + ids.length + ' 题' + (shuffleOn() ? '（乱序）' : '（顺序）'));
    });

    qs('#btnStar').addEventListener('click', () => {
      if (!App.current) return;
      const s = Store.q(App.current.id);
      s.star = !s.star;
      Store.save();
      const star = qs('#btnStar');
      star.classList.toggle('on', s.star);
      star.textContent = s.star ? '★' : '☆';
      toast(s.star ? '已收藏' : '已取消收藏');
    });

    // 答题区事件委托
    qs('#answerArea').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'pick') answerSingle(b.dataset.k);
      else if (act === 'judge') answerJudge(b.dataset.v);
      else if (act === 'submit-blank') submitBlank();
      else if (act === 'show-answer') showAnswer();
      else if (act === 'self-grade') selfGrade(b.dataset.g);
    });

    // 填空题的回车提交统一在 bindKeys 里处理，这里不再单独监听：
    // 两处都监听会让同一次 Enter 先提交、再冒泡到 document 被判成「已作答 → 下一题」，
    // 反馈区刚出现就被翻页，用户看不到对错和正确答案。
  }

  function bindBrowse() {
    qs('#searchInput').addEventListener('input', () => renderBrowse());
    qs('#onlyWrong').addEventListener('change', () => renderBrowse());
    qs('#onlyStar').addEventListener('change', () => renderBrowse());
    qs('#browseChips').addEventListener('click', e => {
      const b = e.target.closest('.chip');
      if (!b) return;
      App.browseType = b.dataset.type;
      qsa('#browseChips .chip').forEach(c => c.classList.toggle('is-on', c === b));
      renderBrowse();
    });
    qs('#browseList').addEventListener('click', e => {
      const p = e.target.closest('[data-practice]');
      if (p) {
        e.stopPropagation();
        practiceOne(p.dataset.practice);
        return;
      }
      const head = e.target.closest('.item-head');
      if (!head) return;
      head.parentElement.classList.toggle('open');
    });
    qs('#weakList').addEventListener('click', e => {
      const it = e.target.closest('.weak-item');
      if (!it) return;
      App.browseType = 'all';
      qsa('#browseChips .chip').forEach(c => c.classList.toggle('is-on', c.dataset.type === 'all'));
      qs('#onlyWrong').checked = true;
      qs('#searchInput').value = Bank.byId[it.dataset.id] ? String(Bank.byId[it.dataset.id].no) : '';
      switchView('browse');
      renderBrowse();
    });
  }

  function bindKeys() {
    // 中文输入法上屏会先发一个 Enter（keyCode 229），记录时间以免被当成「提交」
    document.addEventListener('compositionend', () => { App.composeStamp = Date.now(); }, true);

    document.addEventListener('keydown', e => {
      if (App.view !== 'practice') return;
      const tag = (e.target.tagName || '').toLowerCase();
      const inInput = tag === 'input' || tag === 'textarea';

      if (e.key === 'Escape' && !qs('#noteBox').hidden) { closeNote(); return; }

      if (e.key === 'Enter') {
        // 输入法还在组合（选候选词）时，这个 Enter 属于输入法，不属于答题
        if (e.isComposing || e.keyCode === 229) return;
        if (App.composeStamp && Date.now() - App.composeStamp < 120) return;
        // 同一次按键若刚触发过提交，就不要再当成「下一题」，否则反馈区一闪而过
        if (App.submitStamp && Date.now() - App.submitStamp < 300) return;
        if (App.answered) { e.preventDefault(); nextQuestion(); return; }
        if (inInput || (App.current && App.current.type === 'blank' && !App.answered)) { submitBlank(); return; }
        if (App.current && (App.current.type === 'short' || App.current.type === 'prac')) showAnswer();
        return;
      }
      if (e.key === ' ' && !inInput) {
        if (App.current && (App.current.type === 'short' || App.current.type === 'prac') && !App.answered) {
          e.preventDefault();
          showAnswer();
        }
        return;
      }
      if (inInput) return;

      const k = e.key.toLowerCase();
      if (k === 's' && App.current) { qs('#btnStar').click(); return; }
      if (k === 'n' && App.current) { qs('#btnNote').click(); return; }
      if (['1', '2', '3', '4'].includes(k)) {
        if (!App.current || App.answered) return;
        if (App.current.type === 'single') {
          answerSingle('ABCD'[parseInt(k, 10) - 1]);
        } else if (App.current.type === 'judge' && (k === '1' || k === '2')) {
          answerJudge(k === '1' ? '√' : '×');
        }
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  async function init() {
    await Store.init();
    bindTabs();
    bindPractice();
    bindBrowse();
    bindSettings();
    bindKeys();
    applySettingsToUI();

    // 启动时若目标已达成，不重复提示
    const d0 = Store.state.daily[Scheduler.todayStr()] || {};
    if ((d0.answered || 0) >= (Store.state.settings.dailyGoal || 50)) {
      App.goalHit = Scheduler.todayStr();
    }
    // 系统主题变化时自动跟随
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        if ((Store.state.settings.theme || 'light') === 'auto') applyTheme('auto', false);
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }

    updateTopStats();
    startSession('all', {});
    if (window.Typing) Typing.init();
    if (window.Exam) Exam.init();
    if (window.Recite) Recite.init();
  }

  document.addEventListener('DOMContentLoaded', init);

  // 调试/自动化入口（不影响正常使用）
  window.__SSQ__ = { Bank, App, renderQuestion, startSession, nextQuestion, checkBlank, toast };
  window.__toast = toast;
})();
