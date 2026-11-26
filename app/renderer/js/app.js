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
    browseType: 'all',
    session: null,
    current: null,
    answered: false,
    requeue: {}
  };

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

  /** 返回 true / 'close' / false */
  function checkBlank(user, standard) {
    const u = normText(user);
    if (!u) return false;
    const alts = expandAlts(standard);
    const ns = alts.map(normText).filter(Boolean);
    if (ns.some(a => a === u)) return true;
    // 包含判定：答案核心词被写出（如 “抽样误差（随机误差）” vs “抽样误差”）
    if (ns.some(a => a.length >= 2 && u.length >= 2 && (u.includes(a) || a.includes(u)))) {
      const near = ns.some(a => Math.abs(a.length - u.length) <= 3);
      if (near) return 'close';
    }
    return false;
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
    const pool = Bank.all.filter(q =>
      (type === 'all' || q.type === type) && (!opts.chapter || q.chapter === opts.chapter));

    if (opts.wrongOnly) {
      const arr = pool.filter(q => {
        const s = Store.peek(q.id);
        return s && (s.wrong || 0) > 0 && !Scheduler.isMastered(s);
      });
      arr.sort((a, b) => (Store.peek(b.id).wrong || 0) - (Store.peek(a.id).wrong || 0));
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

    return interleave(dueSel, freshOrdered, 2).map(q => q.id);
  }

  function startSession(type, opts) {
    App.filter = type;
    App.wrongMode = !!(opts && opts.wrongOnly);
    App.chapter = (opts && opts.chapter) || '';
    const ids = buildQueue(type, opts || {});
    App.session = { queue: ids, pos: 0, initial: ids.length };
    App.requeue = {};
    qsa('#typeChips .chip').forEach(c => c.classList.toggle('is-on', c.dataset.type === type));
    qs('#btnWrongMode').classList.toggle('on', App.wrongMode);
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
    while (s.pos < s.queue.length) {
      const id = s.queue[s.pos++];
      const q = Bank.byId[id];
      if (q) { renderQuestion(q); return; }
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
    qs('#emptyState').querySelector('h3').textContent = allFresh ? '这个题型已经练完一轮' : '今天的任务已完成';
    qs('#emptyState').querySelector('p').textContent = allFresh
      ? '该范围没有剩余新题，可切换题型或继续巩固错题。'
      : '没有到期需要复习的题目了。可以切换题型，或额外加练 10 道。';
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

    renderStem(q);
    renderAnswerArea(q);

    qs('#hint').innerHTML = hintFor(q.type);

    card.classList.remove('enter');
    void card.offsetWidth;
    card.classList.add('enter');
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
    f.hidden = false;
  }

  function markNext() {
    qs('#btnNext').hidden = false;
    qs('#hint').hidden = true;
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
    if (correct) showFeedback(true, '答对了　<span style="opacity:.75">已按间隔重复安排下次复习</span>');
    else showFeedback(false, '答错了　正确答案是 <b>' + esc(q.answer) + '．' + esc(ansText) + '</b>');
    record(q, correct ? 4 : 0, correct);
    markNext();
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
    if (correct) showFeedback(true, '判断正确');
    else showFeedback(false, '判断错误　正确答案是 <b>' + (q.answer === '√' ? '√ 正确' : '× 错误') + '</b>');
    record(q, correct ? 4 : 0, correct);
    markNext();
  }

  function submitBlank() {
    if (App.answered) return;
    const q = App.current;
    const inputs = qsa('#answerArea .blank-input, #qStem .blank-input');
    if (!inputs.length) return;

    let allOk = true;
    let anyClose = false;
    inputs.forEach((inp, i) => {
      const std = q.blanks[i] != null ? q.blanks[i] : q.answer;
      const res = checkBlank(inp.value, std);
      inp.classList.remove('right', 'wrong');
      if (res === true) inp.classList.add('right');
      else if (res === 'close') { inp.classList.add('right'); anyClose = true; }
      else { inp.classList.add('wrong'); allOk = false; }
      inp.disabled = true;
    });

    App.answered = true;
    const sub = qs('#answerArea [data-act="submit-blank"]');
    if (sub) { sub.disabled = true; sub.textContent = '已提交'; }
    const std = q.blanks.map((b, i) => '第' + (i + 1) + '空 ' + b).join('；');
    if (allOk) {
      showFeedback(true, '全部填对' + (anyClose ? '（有一处表述略有差异，已计为正确）' : '') +
        (q.blanks.length > 1 ? '　参考答案：<b>' + esc(std) + '</b>' : ''));
    } else {
      showFeedback(false, '参考答案：<b>' + esc(std) + '</b>');
    }
    record(q, allOk ? 4 : 0, allOk);
    markNext();
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
    showFeedback(v >= 4, '自评：' + (v >= 4 ? '掌握' : v === 3 ? '模糊' : '不会') + '　<span style="opacity:.75">' + label + '</span>');
    record(q, v, v >= 4);
    markNext();
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

    if (quality < 4 && st.settings.requeue) {
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

  /* ---------------- 顶栏与进度 ---------------- */
  function updateTopStats() {
    const today = Scheduler.todayStr();
    const st = Store.state;
    const day = st.daily[today] || { answered: 0 };
    let dueCount = 0;
    for (const q of Bank.all) {
      if (Scheduler.isDue(Store.peek(q.id), today)) dueCount++;
    }
    qs('#tsToday').textContent = day.answered || 0;
    qs('#tsDue').textContent = dueCount;
    qs('#tsStreak').textContent = st.meta.streakDays || 0;
    qs('#tsDue').parentElement.classList.toggle('hot', dueCount > 0);
  }

  function updateProgressLine() {
    const s = App.session;
    const day = Store.state.daily[Scheduler.todayStr()] || { answered: 0 };
    const remain = s ? Math.max(0, s.queue.length - s.pos) : 0;
    const done = day.answered || 0;
    const total = done + remain;
    qs('#plNum').textContent = done + ' / ' + total;
    qs('#plBar').style.width = total ? Math.min(100, (done / total) * 100) + '%' : '0%';
  }

  /* ---------------- 题库浏览 ---------------- */
  function renderBrowse() {
    const kw = normText(qs('#searchInput').value);
    const onlyWrong = qs('#onlyWrong').checked;
    const type = App.browseType;

    const rows = Bank.all.filter(q => {
      if (type !== 'all' && q.type !== type) return false;
      if (onlyWrong) {
        const s = Store.peek(q.id);
        if (!s || !(s.wrong > 0)) return false;
      }
      if (kw) {
        const hay = normText(q.stem + ' ' + (q.answerText || '') + ' ' + (q.answer || '') + ' ' +
          (q.options || []).map(o => o.text).join(' ') + ' ' + (q.blanks || []).join(' '));
        if (!hay.includes(kw)) return false;
      }
      return true;
    });

    qs('#browseMeta').textContent = '共 ' + rows.length + ' 题' + (kw ? '（关键词：' + qs('#searchInput').value + '）' : '');
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
      if (s && s.wrong > 0) flags.push('<span class="flag warn">错 ' + s.wrong + '</span>');
      if (s && Scheduler.isMastered(s)) flags.push('<span class="flag ok">已掌握</span>');

      const head = document.createElement('div');
      head.className = 'item-head';
      head.innerHTML =
        '<span class="badge t-' + q.type + '">' + TYPE_SHORT[q.type] + '</span>' +
        '<div class="item-stem"><span class="dim">' + q.no + '.</span>' + esc(q.stem.slice(0, 90)) + (q.stem.length > 90 ? '…' : '') + '</div>' +
        '<div class="item-flags">' + flags.join('') + '</div>';

      const body = document.createElement('div');
      body.className = 'item-body';
      body.innerHTML = buildItemBody(q, q.stem.length > 90);

      item.appendChild(head);
      item.appendChild(body);
      frag.appendChild(item);
    });

    list.appendChild(frag);
  }

  function buildItemBody(q, needFullStem) {
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
    return html;
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
        const n = (day.answered || 0) + Math.round((day.typed || 0) / 60) + (day.exams || 0) * 5;
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
    qsa('#tabs .tab').forEach(b => b.classList.toggle('is-active', b.dataset.view === v));
    ['practice', 'typing', 'exam', 'browse', 'stats', 'settings'].forEach(k => {
      qs('#view-' + k).hidden = k !== v;
    });
    if (v === 'browse') renderBrowse();
    if (v === 'stats') renderStats();
    if (v === 'settings') applySettingsToUI();
  }

  function bindPractice() {
    qs('#typeChips').addEventListener('click', e => {
      const b = e.target.closest('.chip');
      if (!b) return;
      const ch = b.dataset.type === 'short' ? App.chapter : '';
      startSession(b.dataset.type, { chapter: ch });
    });

    qs('#chapterSelect').addEventListener('change', e => {
      startSession('short', { chapter: e.target.value });
    });

    qs('#btnWrongMode').addEventListener('click', () => {
      if (App.wrongMode) startSession(App.filter, {});
      else startSession(App.filter, { wrongOnly: true });
    });

    qs('#btnNext').addEventListener('click', () => nextQuestion());

    qs('#btnExtra').addEventListener('click', () => {
      const ids = Bank.all.filter(q => App.filter === 'all' || q.type === App.filter)
        .map(q => q.id).sort(() => Math.random() - 0.5).slice(0, 10);
      App.session = { queue: ids, pos: 0, initial: ids.length };
      App.requeue = {};
      nextQuestion();
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

    // 填空题回车提交
    qs('#qStem').addEventListener('keydown', e => {
      if (e.key === 'Enter' && App.current && App.current.type === 'blank' && !App.answered) {
        e.preventDefault();
        submitBlank();
      }
    });
  }

  function bindBrowse() {
    qs('#searchInput').addEventListener('input', () => renderBrowse());
    qs('#onlyWrong').addEventListener('change', () => renderBrowse());
    qs('#browseChips').addEventListener('click', e => {
      const b = e.target.closest('.chip');
      if (!b) return;
      App.browseType = b.dataset.type;
      qsa('#browseChips .chip').forEach(c => c.classList.toggle('is-on', c === b));
      renderBrowse();
    });
    qs('#browseList').addEventListener('click', e => {
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
    document.addEventListener('keydown', e => {
      if (App.view !== 'practice') return;
      const tag = (e.target.tagName || '').toLowerCase();
      const inInput = tag === 'input' || tag === 'textarea';

      if (e.key === 'Enter') {
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
    updateTopStats();
    startSession('all', {});
    if (window.Typing) Typing.init();
    if (window.Exam) Exam.init();
  }

  document.addEventListener('DOMContentLoaded', init);

  // 调试/自动化入口（不影响正常使用）
  window.__SSQ__ = { Bank, App, renderQuestion, startSession, nextQuestion, checkBlank, toast };
  window.__toast = toast;
})();
