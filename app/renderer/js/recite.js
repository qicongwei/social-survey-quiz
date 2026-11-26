/* 背题模式：一屏一题，先自测再核对，只记录遍数，不写间隔重复排程 */
const Recite = (() => {
  'use strict';
  const TYPE_SHORT = { single: '单选', judge: '判断', blank: '填空', short: '名解简答', prac: '实操' };

  const $ = id => document.getElementById(id);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

  const st = {
    type: 'all',
    scope: 'all',
    shuffle: false,
    order: [],
    pos: 0,
    revealed: false,
    round: { pass: 0, fuzzy: 0, fail: 0 },
    failed: [],
    lock: false
  };

  const bank = () => (window.__SSQ__ && window.__SSQ__.Bank.all) || [];
  const byId = id => (window.__SSQ__ && window.__SSQ__.Bank.byId[id]) || null;
  const peek = id => Store.peek(id);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- 队列 ---------------- */
  function inScope(q) {
    const s = peek(q.id);
    if (st.scope === 'unmastered') return !Scheduler.isMastered(s);
    if (st.scope === 'star') return !!(s && s.star);
    if (st.scope === 'wrong') return !!(s && (s.wrong || 0) > 0);
    return true;
  }

  function build() {
    let list = bank().filter(q => (st.type === 'all' || q.type === st.type) && inScope(q));
    list = list.slice().sort((a, b) => a.no - b.no);
    if (st.shuffle) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = list[i]; list[i] = list[j]; list[j] = t;
      }
    }
    st.order = list.map(q => q.id);
    st.pos = 0;
    st.revealed = false;
    st.round = { pass: 0, fuzzy: 0, fail: 0 };
    st.failed = [];
    st.lock = false;
    render();
  }

  function cur() {
    const id = st.order[st.pos];
    return id ? byId(id) : null;
  }

  /* ---------------- 渲染 ---------------- */
  function stemHTML(q) {
    let h = '';
    if (q.type === 'prac' && q.title) {
      h += '<span class="q-title">【' + esc(q.kind || '') + '】' + esc(q.title) +
        (q.score ? '　·　' + esc(q.score) : '') + '</span>';
    }
    if (q.type === 'blank') {
      let i = 0;
      h += esc(q.stem).replace(/[＿_]{2,}/g, () => '<span class="rc-hole">' + (++i) + '</span>');
    } else {
      h += esc(q.stem);
    }
    return h;
  }

  function answerHTML(q) {
    let h = '';
    if (q.type === 'single') {
      h += '<div class="rc-opts">' + (q.options || []).map(o =>
        '<div class="rc-opt' + (o.key === q.answer ? ' right' : '') + '">' +
          '<b>' + esc(o.key) + '</b><span>' + esc(o.text) + '</span>' +
          (o.key === q.answer ? '<em>正确</em>' : '') +
        '</div>'
      ).join('') + '</div>';
    } else if (q.type === 'judge') {
      const yes = q.answer === '√';
      h += '<div class="rc-judge">' +
        '<span class="rj' + (yes ? ' on' : '') + '">√　正确</span>' +
        '<span class="rj' + (!yes ? ' on' : '') + '">×　错误</span>' +
      '</div>';
    } else if (q.type === 'blank') {
      h += '<div class="rc-blanks">' + (q.blanks || []).map((b, i) =>
        '<div class="rc-blank"><span>第 ' + (i + 1) + ' 空</span><b>' + esc(b) + '</b></div>'
      ).join('') + '</div>';
    } else {
      h += '<div class="rc-text">' + esc(q.answerText || '（本题暂无参考答案）') + '</div>';
    }
    // 客观题若带解析，附一段说明
    if (q.answerText && (q.type === 'single' || q.type === 'judge' || q.type === 'blank')) {
      h += '<div class="rc-explain"><b>解析</b><span>' + esc(q.answerText) + '</span></div>';
    }
    return h;
  }

  function render() {
    const card = $('rcCard');
    const q = cur();
    st.revealed = false;

    const head = card.querySelector('.qhead');
    head.hidden = !q;
    $('rcStem').hidden = !q;
    $('rcReveal').hidden = !q;
    $('rcAnswer').hidden = true;
    $('rcGrade').hidden = true;
    $('rcDone').hidden = !!q;

    if (!q) { renderDone(); return; }

    const s = peek(q.id);
    const badge = $('rcType');
    badge.textContent = TYPE_SHORT[q.type] || '题目';
    badge.className = 'badge t-' + q.type;
    $('rcNo').textContent = '第 ' + (st.pos + 1) + ' / ' + st.order.length + ' 题';
    $('rcChapter').textContent = q.chapter || '';
    $('rcChapter').hidden = !q.chapter;
    const rec = s && s.recite;
    $('rcTimes').textContent = rec && rec.rounds ? '已背 ' + rec.rounds + ' 遍' : '';
    $('rcTimes').hidden = !(rec && rec.rounds);

    const star = $('rcStar');
    const on = !!(s && s.star);
    star.textContent = on ? '★' : '☆';
    star.classList.toggle('on', on);

    $('rcStem').innerHTML = stemHTML(q);
    $('rcAnswer').innerHTML = answerHTML(q);
    updateMeta();
  }

  function updateMeta() {
    const total = st.order.length;
    const done = Math.min(st.pos, total);
    $('rcPos').textContent = total ? (done + (done < total ? 1 : 0)) + ' / ' + total : '0 / 0';
    $('rcBar').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
    const r = st.round;
    $('rcRound').textContent = '本轮　会 ' + r.pass + ' · 模糊 ' + r.fuzzy + ' · 不会 ' + r.fail;
  }

  function renderDone() {
    const box = $('rcDone');
    const r = st.round;
    const total = r.pass + r.fuzzy + r.fail;

    if (!st.order.length) {
      box.innerHTML = '<div class="rc-empty">' +
        '<b>这个范围还没有题目</b>' +
        '<span>换个题型或范围试试；收藏与错题需要先在「练习」页积累</span>' +
      '</div>';
      $('rcPos').textContent = '0 / 0';
      $('rcBar').style.width = '0%';
      return;
    }

    const acc = total ? Math.round((r.pass + r.fuzzy * 0.5) / total * 100) : 0;
    const cls = acc >= 80 ? 'good' : acc >= 50 ? 'mid' : 'weak';
    box.innerHTML =
      '<div class="rd-hero ' + cls + '">' +
        '<b>' + r.pass + '</b><span>／ ' + total + ' 题会了</span>' +
        '<em>通过率 ' + acc + '%</em>' +
      '</div>' +
      '<div class="rd-items">' +
        '<div><span>会了</span><b class="ok">' + r.pass + '</b></div>' +
        '<div><span>模糊</span><b class="warn">' + r.fuzzy + '</b></div>' +
        '<div><span>不会</span><b class="bad">' + r.fail + '</b></div>' +
      '</div>' +
      '<div class="row-btns rd-btns">' +
        '<button class="ghost-btn" id="rdAgain">再来一轮</button>' +
        (st.failed.length ? '<button class="primary-btn" id="rdFailed">只背不会的 ' + st.failed.length + ' 题</button>' : '') +
      '</div>' +
      '<p class="rd-tip">背题不改变复习排程。想把这些题纳入间隔重复，请到「练习」页作答。</p>';
    $('rcBar').style.width = '100%';
    $('rcPos').textContent = total + ' / ' + total;
  }

  /* ---------------- 交互 ---------------- */
  function reveal() {
    if (!cur()) return;
    st.revealed = true;
    $('rcReveal').hidden = true;
    $('rcAnswer').hidden = false;
    $('rcGrade').hidden = false;
  }

  function step(d) {
    if (!st.order.length) return;
    const np = st.pos + d;
    if (np < 0) return;
    st.pos = Math.min(np, st.order.length);
    render();
  }

  function grade(g) {
    const q = cur();
    if (!q || st.lock) return;
    st.lock = true;

    const s = Store.q(q.id);
    if (!s.recite) s.recite = { pass: 0, fuzzy: 0, fail: 0, rounds: 0, last: '' };
    s.recite[g] = (s.recite[g] || 0) + 1;
    s.recite.rounds = (s.recite.rounds || 0) + 1;
    s.recite.last = Scheduler.todayStr();

    st.round[g]++;
    if (g === 'fail') st.failed.push(q.id);

    const today = Scheduler.todayStr();
    const day = Store.state.daily[today] || (Store.state.daily[today] = { answered: 0, newCount: 0 });
    day.recited = (day.recited || 0) + 1;
    Store.save();

    updateMeta();
    setTimeout(() => {
      st.lock = false;
      step(1);
    }, 130);
  }

  function toggleStar() {
    const q = cur();
    if (!q) return;
    const s = Store.q(q.id);
    s.star = !s.star;
    Store.save();
    $('rcStar').textContent = s.star ? '★' : '☆';
    $('rcStar').classList.toggle('on', !!s.star);
    if (window.__SSQ__ && window.__SSQ__.toast) {
      window.__SSQ__.toast(s.star ? '已收藏' : '已取消收藏');
    }
  }

  function speak() {
    const q = cur();
    if (!q || !window.__speak) return;
    let text = q.stem;
    if (q.type === 'single') {
      text += '。选项：' + (q.options || []).map(o => o.key + '，' + o.text).join('；');
      text += '。正确答案是 ' + q.answer;
    } else if (q.type === 'judge') {
      text += '。正确答案是 ' + (q.answer === '√' ? '正确' : '错误');
    } else if (q.type === 'blank') {
      text += '。答案是：' + (q.blanks || []).join('；');
    } else {
      text += '。' + (q.answerText || '');
    }
    window.__speak(text);
  }

  function bind() {
    $('reciteChips').addEventListener('click', e => {
      const b = e.target.closest('.chip');
      if (!b) return;
      st.type = b.dataset.type;
      qsa('#reciteChips .chip').forEach(c => c.classList.toggle('is-on', c === b));
      build();
    });

    $('reciteScope').addEventListener('change', e => {
      st.scope = e.target.value;
      build();
    });

    $('reciteShuffle').addEventListener('click', () => {
      st.shuffle = !st.shuffle;
      $('reciteShuffle').classList.toggle('on', st.shuffle);
      build();
      if (window.__SSQ__ && window.__SSQ__.toast) {
        window.__SSQ__.toast(st.shuffle ? '已打乱顺序' : '已恢复题号顺序');
      }
    });

    $('rcShow').addEventListener('click', reveal);
    $('rcPrev').addEventListener('click', () => step(-1));
    $('rcNext').addEventListener('click', () => step(1));
    $('rcReset').addEventListener('click', () => build());
    $('rcStar').addEventListener('click', toggleStar);
    $('rcSpeak').addEventListener('click', speak);

    $('rcGrade').addEventListener('click', e => {
      const b = e.target.closest('[data-g]');
      if (b) grade(b.dataset.g);
    });

    $('rcDone').addEventListener('click', e => {
      if (e.target.id === 'rdAgain') build();
      if (e.target.id === 'rdFailed') {
        const ids = st.failed.slice();
        st.order = ids;
        st.pos = 0;
        st.round = { pass: 0, fuzzy: 0, fail: 0 };
        st.failed = [];
        st.revealed = false;
        render();
      }
    });

    document.addEventListener('keydown', e => {
      if (!window.__SSQ__ || window.__SSQ__.App.view !== 'recite') return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      const k = e.key;
      if (k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        if (!st.revealed) reveal(); else step(1);
        return;
      }
      if (k === 'Enter') {
        e.preventDefault();
        if (st.revealed) step(1); else reveal();
        return;
      }
      if (k === 'ArrowRight') { e.preventDefault(); step(1); return; }
      if (k === 'ArrowLeft') { e.preventDefault(); step(-1); return; }
      if (k === 'Escape') { if ($('rcDone').hidden) step(1); return; }
      if (k === 's' || k === 'S') { toggleStar(); return; }
      if (k === '1' || k === '2' || k === '3') {
        e.preventDefault();
        if (!st.revealed) { reveal(); return; }
        grade(k === '1' ? 'fail' : k === '2' ? 'fuzzy' : 'pass');
      }
    });
  }

  function init() {
    bind();
    build();
  }

  function onEnter() {
    // 首次进入或数据变化后队列为空时重建
    if (!st.order.length) build();
    else { render(); }
  }

  const api = { init, onEnter, build, refresh: render, get state() { return st; } };
  window.Recite = api;
  return api;
})();
