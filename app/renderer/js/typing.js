/* 打字训练：对着参考答案逐字输入，实时比对、计时与评分 */
const Typing = (() => {
  'use strict';
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

  const TYPE_SHORT = { short: '名解简答', prac: '实操' };
  const LAYOUT_RE = /[\s\u3000]/;
  const PUNC_RE = /[，。、；：？！“”‘’（）()《》〈〉【】…—－·,.!?;:'"]/;

  let queue = [];
  let pos = 0;
  let cur = null;
  let refText = '';
  let spans = [];
  let started = false;
  let t0 = 0;
  let timer = null;
  let finished = false;
  let stat = { correct: 0, errors: 0, cursor: 0 };
  let scope = 'subj';
  let mode = 'see';

  const $ = id => document.getElementById(id);

  /* ---------- 题库 ---------- */
  function pool(sc) {
    const all = (window.__SSQ__ && window.__SSQ__.Bank.all) || [];
    if (sc === 'short') return all.filter(q => q.type === 'short');
    if (sc === 'prac') return all.filter(q => q.type === 'prac');
    return all.filter(q => q.type === 'short' || q.type === 'prac');
  }

  function countChars(s) {
    return s.replace(/[\s\u3000]/g, '').length;
  }

  /* ---------- 渲染 ---------- */
  function mountRef(text) {
    const box = $('typeRef');
    box.innerHTML = '';
    spans = [];
    const frag = document.createDocumentFragment();
    for (const ch of text) {
      const s = document.createElement('span');
      s.textContent = ch;
      frag.appendChild(s);
      spans.push(s);
    }
    box.appendChild(frag);
    box.classList.toggle('blind', mode === 'blind');
    box.scrollTop = 0;
    setTimeout(updateFade, 0);
  }

  function paint() {
    const n = spans.length;
    for (let i = 0; i < n; i++) {
      const st = stat.states ? stat.states[i] : 'todo';
      let cls = '';
      if (i === stat.cursor) cls = 'cur';
      else if (st === 'ok') cls = 'ok';
      else if (st === 'bad') cls = 'bad';
      else if (st === 'skip') cls = 'skip';
      if (spans[i].className !== cls) spans[i].className = cls;
    }
    if (stat.cursor > 0 && stat.cursor % 24 === 0 && spans[stat.cursor]) {
      const box = $('typeRef');
      const el = spans[stat.cursor];
      const top = el.offsetTop - box.clientHeight / 2;
      if (top > 0) box.scrollTop = top;
    }
    updateFade();
  }

  function updateFade() {
    const box = $('typeRef');
    const wrap = box && box.parentElement;
    if (!wrap || !wrap.classList.contains('type-ref-wrap')) return;
    const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 6;
    wrap.classList.toggle('at-end', atEnd);
  }

  /* ---------- 核心：逐字对齐（带漏打/多打自愈） ---------- */
  function align(ref, input, skipPunc) {
    const n = ref.length;
    const states = new Array(n).fill('todo');
    let i = 0, j = 0, correct = 0, errors = 0;

    while (j < input.length) {
      if (i >= n) { errors++; j++; continue; }
      const a = ref[i];
      const b = input[j];
      if (a === b) {
        states[i] = 'ok'; correct++; i++; j++; continue;
      }
      if (LAYOUT_RE.test(a)) { states[i] = 'skip'; i++; continue; }
      if (skipPunc && PUNC_RE.test(a)) { states[i] = 'skip'; i++; continue; }
      if (LAYOUT_RE.test(b)) { j++; continue; }
      // 自愈①：用户漏打了 ref[i]，输入已对上 ref[i+1]
      if (ref[i + 1] === b) { states[i] = 'bad'; errors++; i++; continue; }
      // 自愈②：用户多打了一个字，下一个输入才对上 ref[i]
      if (ref[i] === input[j + 1]) { states[i] = 'bad'; errors++; j++; continue; }
      states[i] = 'bad'; errors++; i++; j++;
    }
    return { states, cursor: i, correct, errors };
  }

  /* ---------- 统计 ---------- */
  function elapsedSec() {
    return started ? Math.max(0, (Date.now() - t0) / 1000) : 0;
  }

  function fmtTime(s) {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return m + ':' + (ss < 10 ? '0' + ss : ss);
  }

  function paintStats() {
    const total = stat.correct + stat.errors;
    const acc = total ? stat.correct / total : 0;
    const el = elapsedSec();
    const cpm = el > 1 ? Math.round(stat.correct / (el / 60)) : 0;
    $('stProg').textContent = Math.round((stat.cursor / Math.max(1, refText.length)) * 100) + '%';
    $('stAcc').textContent = total ? Math.round(acc * 100) + '%' : '—';
    $('stCpm').textContent = cpm;
    $('stErr').textContent = stat.errors;
    $('stTime').textContent = fmtTime(el);
  }

  /* ---------- 交互 ---------- */
  function startTimer() {
    if (started) return;
    started = true;
    t0 = Date.now();
    clearInterval(timer);
    timer = setInterval(paintStats, 500);
  }

  function onInput() {
    if (finished) return;
    const val = $('typeInput').value;
    if (!started && val.length) startTimer();
    stat = align(refText, val, Store.state.settings.skipPunc !== false);
    paint();
    paintStats();

    if (stat.cursor >= refText.length && val.length) {
      setTimeout(() => {
        if (!finished && $('typeInput').value === val) finish(true);
      }, 260);
    }
  }

  function score() {
    const total = stat.correct + stat.errors;
    const acc = total ? stat.correct / total : 0;
    const el = Math.max(1, elapsedSec());
    const cpm = Math.round(stat.correct / Math.max(el / 60, 0.05));
    const s = Math.round(Math.max(0, Math.min(100, acc * 75 + Math.min(25, (cpm / 60) * 25))));
    return { score: s, acc, cpm, el };
  }

  function finish(auto) {
    if (finished || !cur) return;
    finished = true;
    clearInterval(timer);
    paintStats();

    const { score: sc, acc, cpm, el } = score();
    const today = Scheduler.todayStr();
    const rec = Store.state.typing[cur.id] || { best: 0, tries: 0 };
    rec.tries = (rec.tries || 0) + 1;
    rec.lastScore = sc;
    rec.lastAcc = Math.round(acc * 100);
    rec.lastCpm = cpm;
    rec.lastAt = today;
    rec.best = Math.max(rec.best || 0, sc);
    Store.state.typing[cur.id] = rec;
    Store.state.typingLog = (Store.state.typingLog || []).concat([{
      at: today, id: cur.id, score: sc, cpm, acc: Math.round(acc * 100)
    }]).slice(-120);

    if (!Store.state.daily[today]) Store.state.daily[today] = { answered: 0, right: 0, newCount: 0 };
    Store.state.daily[today].typed = (Store.state.daily[today].typed || 0) + countChars(refText);
    Store.save();

    const grade = sc >= 90 ? '优秀' : sc >= 75 ? '良好' : sc >= 60 ? '合格' : '需再练';
    const box = $('typeResult');
    box.hidden = false;
    box.className = 'type-result' + (sc >= 75 ? ' good' : sc >= 60 ? '' : ' weak');
    box.innerHTML =
      '<div class="tr-score"><b>' + sc + '</b><span>分 · ' + grade + '</span></div>' +
      '<div class="tr-items">' +
      '<div><span>正确率</span><b>' + Math.round(acc * 100) + '%</b></div>' +
      '<div><span>速度</span><b>' + cpm + '</b><em>字/分</em></div>' +
      '<div><span>用时</span><b>' + fmtTime(el) + '</b></div>' +
      '<div><span>错误</span><b>' + stat.errors + '</b></div>' +
      '<div><span>历史最佳</span><b>' + rec.best + '</b></div>' +
      '</div>' +
      (stat.errors ? '<div class="tr-tip">红色字符为打错的位置，可点「重打」再练一遍</div>' :
        '<div class="tr-tip ok">全对' + (auto ? '，已自动提交' : '') + '</div>');

    $('typeInput').readOnly = true;
    $('typeSubmit').hidden = true;
    $('typeNext').hidden = false;
    $('typeNext').focus();
    $('typeHint').innerHTML = '本次得分 <b>' + sc + '</b> · 历史最佳 <b>' + rec.best + '</b>';

    if (mode === 'blind') $('typeRef').classList.remove('blind');
  }

  function reset(keepMode) {
    finished = false;
    started = false;
    clearInterval(timer);
    stat = { correct: 0, errors: 0, cursor: 0, states: new Array(refText.length).fill('todo') };
    $('typeInput').value = '';
    $('typeInput').readOnly = false;
    $('typeResult').hidden = true;
    $('typeSubmit').hidden = false;
    $('typeNext').hidden = true;
    $('typeHint').innerHTML = '开始输入即计时 · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 提交';
    mountRef(refText);
    paint();
    paintStats();
    $('typeInput').focus();
  }

  function render() {
    if (!queue.length) {
      $('tqStem').textContent = '当前范围没有可训练的主观题。';
      $('typeRef').innerHTML = '';
      $('typeInput').disabled = true;
      return;
    }
    cur = queue[pos % queue.length];
    refText = (cur.answerText || '').replace(/\n{3,}/g, '\n\n').trim();
    if (!refText) refText = '（本题暂无参考答案）';

    $('tqType').textContent = TYPE_SHORT[cur.type] || '主观题';
    $('tqType').className = 'badge t-' + cur.type;
    $('tqNo').textContent = '第 ' + (pos % queue.length + 1) + ' / ' + queue.length + ' 题';
    $('tqChapter').textContent = cur.chapter || (cur.kind ? '【' + cur.kind + '】' : '');
    $('tqLen').textContent = countChars(refText) + ' 字';

    const stem = $('tqStem');
    stem.innerHTML = '';
    if (cur.type === 'prac') {
      const t = document.createElement('div');
      t.className = 'q-title';
      t.textContent = '【' + cur.kind + '】' + cur.title;
      stem.appendChild(t);
    }
    stem.appendChild(document.createTextNode(cur.stem));

    const rec = Store.state.typing[cur.id];
    $('tqBest').textContent = rec && rec.best ? '最佳 ' + rec.best : '';

    $('typeInput').disabled = false;
    reset();
  }

  function next() {
    pos = (pos + 1) % Math.max(1, queue.length);
    render();
  }

  function speak() {
    if (!cur) return;
    window.__speak(cur.stem + '。' + refText.replace(/\n/g, '，'));
  }

  function bind() {
    $('typeInput').addEventListener('input', onInput);
    $('typeInput').addEventListener('compositionend', () => setTimeout(onInput, 0));
    // 禁止粘贴：打字训练必须逐字输入，否则速度与正确率失去意义
    $('typeInput').addEventListener('paste', e => {
      e.preventDefault();
      if (window.__toast) window.__toast('打字训练不支持粘贴，请逐字输入');
    });
    $('typeInput').addEventListener('drop', e => e.preventDefault());
    $('typeRef').addEventListener('scroll', updateFade);
    $('typeInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        finish(false);
      }
    });
    $('typeSubmit').addEventListener('click', () => finish(false));
    $('typeNext').addEventListener('click', next);
    $('typeRestart').addEventListener('click', () => reset(true));
    $('typingSpeak').addEventListener('click', speak);

    $('typingChips').addEventListener('click', e => {
      const b = e.target.closest('.chip');
      if (!b) return;
      scope = b.dataset.scope;
      qsa('#typingChips .chip').forEach(c => c.classList.toggle('is-on', c === b));
      queue = pool(scope);
      pos = 0;
      render();
    });

    $('typingModes').addEventListener('click', e => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      mode = b.dataset.mode;
      Store.state.settings.typingMode = mode;
      Store.save();
      qsa('#typingModes [data-mode]').forEach(c => c.classList.toggle('is-on', c === b));
      $('typeRef').classList.toggle('blind', mode === 'blind' && !finished);
    });

    $('typingSkipPunc').addEventListener('change', e => {
      Store.state.settings.skipPunc = e.target.checked;
      Store.save();
      onInput();
    });

    $('tqHide').addEventListener('click', () => {
      const box = $('typeRef');
      box.classList.toggle('blind');
      $('tqHide').classList.toggle('on', box.classList.contains('blind'));
    });
  }

  function init() {
    if (!$('view-typing')) return;
    bind();

    if (Store.state.settings.typingMode) mode = Store.state.settings.typingMode;
    qsa('#typingModes [data-mode]').forEach(c => c.classList.toggle('is-on', c.dataset.mode === mode));
    $('typingSkipPunc').checked = Store.state.settings.skipPunc !== false;

    queue = pool(scope);
    pos = 0;
    render();
  }

  return { init, reset, next, pool };
})();

window.Typing = Typing;

/* 系统朗读（Web Speech API） */
window.__speak = function (text) {
  try {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text || '').slice(0, 3000));
    u.lang = 'zh-CN';
    u.rate = 0.95;
    const voices = speechSynthesis.getVoices();
    const zh = voices.find(v => /zh[-_]CN|Chinese|Yaoyao|Huihui|Kangkang/i.test(v.lang + v.name));
    if (zh) u.voice = zh;
    speechSynthesis.speak(u);
  } catch (e) {
    console.warn('朗读不可用', e);
  }
};
