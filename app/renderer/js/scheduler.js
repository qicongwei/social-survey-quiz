/* 间隔重复：简化 SM-2。掌握等级以“天”为单位排程。 */
const Scheduler = (() => {
  const SEQ = [1, 3, 7, 15, 30];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function todayStr(d = new Date()) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    return todayStr(dt);
  }

  function diffDays(a, b) {
    const t1 = new Date(a + 'T00:00:00').getTime();
    const t2 = new Date(b + 'T00:00:00').getTime();
    return Math.round((t1 - t2) / 86400000);
  }

  /**
   * 评定一题
   * @param {string} id 题目 id
   * @param {number} q  质量：0 不会 / 3 模糊 / 4 答对 / 5 轻松
   */
  function grade(id, q) {
    const s = Store.q(id);
    const today = todayStr();
    s.last = today;

    if (q >= 4) {
      s.right = (s.right || 0) + 1;
      s.reps = (s.reps || 0) + 1;
      const base = s.reps <= SEQ.length ? SEQ[s.reps - 1] : Math.round((s.interval || 30) * 1.6);
      s.interval = Math.min(base, 180);
      s.ease = Math.min(2.8, (s.ease || 2.5) + (q === 5 ? 0.08 : 0));
    } else if (q === 3) {
      // 模糊：不推进轮次，间隔减半，至少隔 1 天
      s.reps = Math.max(1, s.reps || 1);
      s.interval = Math.max(1, Math.round((s.interval || 2) * 0.5));
      s.ease = Math.max(1.8, (s.ease || 2.5) - 0.05);
    } else {
      // 不会：打回重来，当天内再现
      s.wrong = (s.wrong || 0) + 1;
      s.lapses = (s.lapses || 0) + 1;
      s.reps = 0;
      s.interval = 0;
      s.ease = Math.max(1.7, (s.ease || 2.5) - 0.2);
      s.due = today;
      return s;
    }
    s.due = addDays(today, s.interval);
    return s;
  }

  function isMastered(s) {
    return !!s && (s.reps || 0) >= 4 && (s.interval || 0) >= 15;
  }

  function isLearned(s) {
    return !!s && !!s.last;
  }

  function isDue(s, today = todayStr()) {
    return isLearned(s) && (!s.due || s.due <= today);
  }

  /** 掌握度 0-3，用于题头小圆点 */
  function level(s) {
    if (!s || !s.last) return 0;
    if (isMastered(s)) return 3;
    if ((s.reps || 0) >= 2) return 2;
    return 1;
  }

  return { todayStr, addDays, diffDays, grade, isMastered, isLearned, isDue, level, SEQ };
})();
