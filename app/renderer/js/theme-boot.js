/*
 * 启动前预置主题，避免深色用户启动时先闪一下浅色背景。
 * 进度文件在 IPC 层异步读取，这里用 localStorage 的镜像值做首帧判断。
 */
(function () {
  try {
    var t = localStorage.getItem('ssq-theme') || 'light';
    var dark = t === 'dark' ||
      (t === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themeMode = t;
  } catch (e) { /* localStorage 不可用时保持默认浅色 */ }
})();
