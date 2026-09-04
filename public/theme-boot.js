(() => {
  const saved = localStorage.getItem('vprThemeMode') || 'auto';
  const mode = ['auto', 'light', 'dark'].includes(saved) ? saved : 'auto';
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode;
  document.documentElement.dataset.motion = 'off';
})();
