/* 进度持久化：Electron 下写入用户数据目录的 progress.json；浏览器下退回 localStorage */
const Store = (() => {
  const KEY = 'ssq-progress-v1';
  const isDesktop = typeof window !== 'undefined' && !!window.desktopAPI;
  let state = null;
  let timer = null;

  function defaults() {
    return {
      version: 1,
      questions: {},
      daily: {},
      typing: {},
      typingLog: [],
      exams: [],
      meta: { streakLast: '', streakDays: 0, totalAnswered: 0, totalRight: 0, createdAt: new Date().toISOString() },
      settings: {
        newPerDay: 30, reviewPerDay: 80, requeue: true, typingMode: 'see', skipPunc: true,
        theme: 'light', dailyGoal: 50, reciteCover: false, autoNext: true, shuffle: false
      }
    };
  }

  function merge(raw) {
    const d = defaults();
    if (!raw || typeof raw !== 'object') return d;
    return {
      version: 1,
      questions: raw.questions && typeof raw.questions === 'object' ? raw.questions : {},
      daily: raw.daily && typeof raw.daily === 'object' ? raw.daily : {},
      typing: raw.typing && typeof raw.typing === 'object' ? raw.typing : {},
      typingLog: Array.isArray(raw.typingLog) ? raw.typingLog.slice(-120) : [],
      exams: Array.isArray(raw.exams) ? raw.exams.slice(-50) : [],
      meta: Object.assign(d.meta, raw.meta || {}),
      settings: Object.assign(d.settings, raw.settings || {})
    };
  }

  async function init() {
    let raw = null;
    try {
      if (isDesktop) {
        raw = await window.desktopAPI.loadProgress();
      } else {
        const txt = localStorage.getItem(KEY);
        raw = txt ? JSON.parse(txt) : null;
      }
    } catch (e) {
      console.warn('读取进度失败，使用空白进度', e);
    }
    state = merge(typeof raw === 'string' ? JSON.parse(raw) : raw);
    return state;
  }

  function save(immediate = false) {
    if (!state) return;
    const payload = JSON.stringify(state);
    const flush = async () => {
      try {
        if (isDesktop) await window.desktopAPI.saveProgress(payload);
        else localStorage.setItem(KEY, payload);
      } catch (e) {
        console.error('保存失败', e);
      }
    };
    if (immediate) { clearTimeout(timer); return flush(); }
    clearTimeout(timer);
    timer = setTimeout(flush, 350);
  }

  function q(id) {
    if (!state.questions[id]) {
      state.questions[id] = { reps: 0, interval: 0, ease: 2.5, due: '', last: '', right: 0, wrong: 0, lapses: 0, star: false, note: '' };
    }
    return state.questions[id];
  }

  function peek(id) { return state.questions[id] || null; }

  function reset() {
    state = defaults();
    save(true);
  }

  function exportJSON() { return JSON.stringify(state, null, 2); }

  async function importJSON(text) {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== 'object' || !obj.questions) throw new Error('文件格式不正确');
    state = merge(obj);
    await save(true);
  }

  return {
    get state() { return state; },
    get isDesktop() { return isDesktop; },
    init, save, q, peek, reset, exportJSON, importJSON
  };
})();
