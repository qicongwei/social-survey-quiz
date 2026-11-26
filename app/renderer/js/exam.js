/* 模拟考试：随机组卷、限时作答、交卷判分与错题回顾 */
const Exam = (() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const TYPE_SHORT = { single: '单选', judge: '判断', blank: '填空' };

  let cfg = { n: 30, minutes: 30 };
  let session = null;
  let tick = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function shuffle(a) {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [r[i], r[j]] = [r[j], r[i]];
    }
    return r;
  }
  function fmt(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function build(n) {
    const all = (window.__SSQ__ && window.__SSQ__.Bank.all) || [];
    const singles = shuffle(all.filter(q => q.type === 'single'));
    const judges = shuffle(all.filter(q => q.type === 'judge'));
    const blanks = shuffle(all.filter(q => q.type === 'blank'));
    const ns = Math.round(n * 0.5);
    const nj = Math.round(n * 0.25);
    const nb = Math.max(0, n - ns - nj);
    const pick = []
      .concat(singles.slice(0, ns))
      .concat(judges.slice(0, nj))
      .concat(blanks.slice(0, nb));
    return pick.map(q => ({ q, answer: q.type === 'blank' ? [] : null, ok: null, flag: false }));
  }

  function isAnswered(it) {
    return it.q.type === 'blank'
      ? (it.answer || []).some(v => String(v || '').trim())
      : !!it.answer;
  }

  function renderSheet() {
    const grid = $('esGrid');
    grid.innerHTML = session.items.map((it, i) =>
      '<button class="es-cell" data-i="' + i + '">' + (i + 1) + '</button>'
    ).join('');
    $('examSheet').classList.remove('folded');
    $('esToggle').textContent = '收起';
    syncSheet();
  }

  function syncSheet() {
    if (!session) return;
    const cells = qsa('.es-cell', $('esGrid'));
    cells.forEach((el, i) => {
      const it = session.items[i];
      if (!it) return;
      el.classList.toggle('done', isAnswered(it));
      el.classList.toggle('flag', !!it.flag);
    });
    const n = session.items.filter(isAnswered).length;
    const f = session.items.filter(it => it.flag).length;
    $('esStat').textContent = '已答 ' + n + ' / ' + session.items.length + (f ? '　标记 ' + f : '');
  }

  function jumpTo(i) {
    const card = $('examList').querySelector('.exam-q[data-i="' + i + '"]');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('hit');
    void card.offsetWidth;
    card.classList.add('hit');
    const inp = card.querySelector('input');
    if (inp) setTimeout(() => inp.focus({ preventScroll: true }), 320);
  }

  function toggleFlag(i) {
    const it = session.items[i];
    if (!it) return;
    it.flag = !it.flag;
    const card = $('examList').querySelector('.exam-q[data-i="' + i + '"]');
    if (card) {
      const b = card.querySelector('.es-flag');
      if (b) b.classList.toggle('on', it.flag);
    }
    syncSheet();
  }

  function renderStart() {
    $('examStart').hidden = false;
    $('examRun').hidden = true;
    $('examResult').hidden = true;

    const hist = (Store.state.exams || []).slice(-6).reverse();
    const box = $('examHistory');
    if (!hist.length) {
      box.innerHTML = '<div class="muted" style="font-size:13px">还没有考试记录</div>';
    } else {
      box.innerHTML = hist.map(e =>
        '<div class="exam-hist"><div><b>' + e.score + '</b> 分</div>' +
        '<div class="eh-meta">' + e.right + '/' + e.total + ' 题 · ' + fmt(e.secs) + ' · ' + e.at + '</div></div>'
      ).join('');
    }
  }

  function renderRun() {
    $('examStart').hidden = true;
    $('examResult').hidden = true;
    $('examRun').hidden = false;

    const list = $('examList');
    list.innerHTML = '';
    session.items.forEach((it, i) => {
      const q = it.q;
      const card = document.createElement('div');
      card.className = 'exam-q';
      card.dataset.i = i;

      let head = '<div class="exam-qhead"><span class="badge t-' + q.type + '">' + (TYPE_SHORT[q.type] || '') + '</span>' +
        '<span class="qno">第 ' + (i + 1) + ' 题</span>' +
        (q.chapter ? '<span class="qchapter">' + esc(q.chapter) + '</span>' : '') +
        '<span class="eq-right"><button class="icon-btn es-flag" data-i="' + i + '" title="标记待定，交卷前快速定位">⚑</button></span>' +
        '</div>';

      let body = '';
      if (q.type === 'single') {
        body = '<div class="options">' + q.options.map(o =>
          '<button class="opt" data-i="' + i + '" data-k="' + o.key + '">' +
          '<span class="k">' + o.key + '</span><span class="t">' + esc(o.text) + '</span></button>'
        ).join('') + '</div>';
      } else if (q.type === 'judge') {
        body = '<div class="judge-row judge-sm">' +
          '<button class="judge-btn" data-i="' + i + '" data-v="√">√<span>正确</span></button>' +
          '<button class="judge-btn" data-i="' + i + '" data-v="×">×<span>错误</span></button></div>';
      } else {
        const n = Math.max(1, (q.blanks || []).length);
        body = '<div class="exam-blanks">' + Array.from({ length: n }, (_, bi) =>
          '<input class="blank-input" data-i="' + i + '" data-b="' + bi + '" placeholder="第 ' + (bi + 1) + ' 空" autocomplete="off">'
        ).join('') + '</div>';
      }

      card.innerHTML = head + '<div class="exam-stem">' + esc(q.stem) + '</div>' + body;
      list.appendChild(card);
    });

    renderSheet();
    updateProgress();
    startTimer();
  }

  function startTimer() {
    clearInterval(tick);
    const end = session.deadline;
    const loop = () => {
      const left = Math.max(0, (end - Date.now()) / 1000);
      $('examClock').textContent = fmt(left);
      $('examClock').classList.toggle('urgent', left <= 300);
      if (left <= 0) {
        clearInterval(tick);
        submit(true);
      }
    };
    loop();
    tick = setInterval(loop, 1000);
  }

  function updateProgress() {
    const answered = session.items.filter(isAnswered).length;
    $('examDone').textContent = answered + ' / ' + session.items.length;
    syncSheet();
  }

  function onPick(i, key) {
    const it = session.items[i];
    if (!it) return;
    it.answer = key;
    const card = $('examList').querySelector('.exam-q[data-i="' + i + '"]');
    card.querySelectorAll('.opt').forEach(el => el.classList.toggle('sel', el.dataset.k === key));
    card.querySelectorAll('.judge-btn').forEach(el => el.classList.toggle('sel', el.dataset.v === key));
    updateProgress();
  }

  function onBlank(i, bi, val) {
    const it = session.items[i];
    if (!it) return;
    it.answer = it.answer || [];
    it.answer[bi] = val;
    updateProgress();
  }

  function submit(auto) {
    if (!session || session.done) return;
    clearInterval(tick);
    session.done = true;

    const items = session.items;
    let right = 0;
    items.forEach(it => {
      const q = it.q;
      if (q.type === 'single' || q.type === 'judge') {
        it.ok = it.answer === q.answer;
      } else {
        const std = (q.blanks && q.blanks.length) ? q.blanks : [q.answer];
        const given = it.answer || [];
        it.ok = std.every((s, k) => window.__SSQ__.checkBlank(given[k] || '', s) !== false);
      }
      if (it.ok) right++;
    });

    const secs = Math.round((Date.now() - session.startedAt) / 1000);
    const score = Math.round((right / items.length) * 100);
    const rec = {
      at: Scheduler.todayStr(),
      total: items.length, right, score, secs,
      wrong: items.filter(it => !it.ok).map(it => it.q.id)
    };
    Store.state.exams = (Store.state.exams || []).concat([rec]).slice(-50);
    const today = Scheduler.todayStr();
    if (!Store.state.daily[today]) Store.state.daily[today] = { answered: 0, right: 0, newCount: 0 };
    Store.state.daily[today].exams = (Store.state.daily[today].exams || 0) + 1;
    Store.save();

    renderResult(rec, auto);
  }

  function renderResult(rec, auto) {
    $('examRun').hidden = true;
    $('examResult').hidden = false;

    const items = session.items;
    const wrong = items.filter(it => !it.ok);

    let html =
      '<div class="result-hero">' +
      '<div class="rh-score ' + (rec.score >= 80 ? 'good' : rec.score >= 60 ? '' : 'weak') + '">' + rec.score + '</div>' +
      '<div class="rh-meta">' + (auto ? '时间到，已自动交卷' : '已交卷') + ' · 正确 ' + rec.right + ' / ' + rec.total + ' · 用时 ' + fmt(rec.secs) + '</div>' +
      '</div>';

    if (wrong.length) {
      html += '<h3 style="margin:22px 0 10px">错题回顾（' + wrong.length + '）</h3><div class="exam-wrong">';
      html += wrong.map(it => {
        const q = it.q;
        let myAns = '未作答', stdAns = '';
        if (q.type === 'single') {
          myAns = it.answer
            ? it.answer + '．' + ((q.options.find(o => o.key === it.answer) || {}).text || '')
            : '未作答';
          stdAns = q.answer + '．' + ((q.options.find(o => o.key === q.answer) || {}).text || '');
        } else if (q.type === 'judge') {
          myAns = it.answer ? (it.answer === '√' ? '√ 正确' : '× 错误') : '未作答';
          stdAns = q.answer === '√' ? '√ 正确' : '× 错误';
        } else {
          myAns = (it.answer || []).filter(Boolean).join('；') || '未作答';
          stdAns = (q.blanks || [q.answer]).join('；');
        }
        return '<div class="ew-item"><div class="ew-stem"><span style="color:var(--ink3);margin-right:6px">' +
          q.no + '.</span>' + esc(q.stem) + '</div>' +
          '<div class="ew-line"><span>你的答案</span><b class="bad">' + esc(myAns) + '</b></div>' +
          '<div class="ew-line"><span>正确答案</span><b class="ok">' + esc(stdAns) + '</b></div></div>';
      }).join('');
      html += '</div>';
    } else {
      html += '<div class="all-right">全部答对</div>';
    }

    $('examResultBody').innerHTML = html;
  }

  function begin() {
    cfg.n = parseInt($('examCount').value, 10) || 30;
    cfg.minutes = parseInt($('examMinutes').value, 10) || 30;
    const items = build(cfg.n);
    if (!items.length) return;
    session = {
      items,
      startedAt: Date.now(),
      deadline: Date.now() + cfg.minutes * 60000,
      done: false
    };
    $('examResultBody').innerHTML = '';
    renderRun();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function backHome() {
    clearInterval(tick);
    session = null;
    renderStart();
  }

  function confirmSubmit() {
    if (!session) return false;
    const missing = session.items.map((it, i) => ({ it, i })).filter(x => !isAnswered(x.it));
    const flags = session.items.filter(it => it.flag).length;
    if (missing.length) {
      const nos = missing.slice(0, 12).map(x => x.i + 1).join('、');
      return confirm('还有 ' + missing.length + ' 题未作答（第 ' + nos + (missing.length > 12 ? ' 等' : '') + ' 题）。确定交卷吗？');
    }
    if (flags) return confirm('还有 ' + flags + ' 题标记为待定，确定交卷吗？');
    return confirm('确定交卷吗？');
  }

  function bind() {
    $('examBegin').addEventListener('click', begin);
    $('examBack').addEventListener('click', backHome);
    $('examAgain').addEventListener('click', begin);
    $('examHome').addEventListener('click', backHome);

    $('examSubmit').addEventListener('click', () => {
      if (confirmSubmit()) submit(false);
    });

    // 答题卡跳转
    $('esGrid').addEventListener('click', e => {
      const cell = e.target.closest('.es-cell');
      if (!cell) return;
      jumpTo(parseInt(cell.dataset.i, 10));
    });

    $('esToggle').addEventListener('click', () => {
      const folded = $('examSheet').classList.toggle('folded');
      $('esToggle').textContent = folded ? '展开' : '收起';
    });

    $('examList').addEventListener('click', e => {
      const fb = e.target.closest('.es-flag');
      if (fb) { toggleFlag(parseInt(fb.dataset.i, 10)); return; }
      const b = e.target.closest('[data-i]');
      if (!b || b.tagName === 'INPUT') return;
      const i = parseInt(b.dataset.i, 10);
      if (b.dataset.k) onPick(i, b.dataset.k);
      else if (b.dataset.v) onPick(i, b.dataset.v);
    });

    $('examList').addEventListener('input', e => {
      const el = e.target;
      if (el.tagName !== 'INPUT') return;
      onBlank(parseInt(el.dataset.i, 10), parseInt(el.dataset.b, 10), el.value);
    });

    // 快捷键：交卷前可用 Esc 返回确认
    document.addEventListener('keydown', e => {
      if (window.__SSQ__ && window.__SSQ__.App.view !== 'exam') return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'Escape' && session && !session.done) {
        if (confirmSubmit()) submit(false);
      }
    });
  }

  function init() {
    if (!$('view-exam')) return;
    bind();
    renderStart();
  }

  return { init, begin };
})();

window.Exam = Exam;
