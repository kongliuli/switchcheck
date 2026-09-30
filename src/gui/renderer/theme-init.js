// Runs synchronously before the stylesheet: resolves the stored theme
// (system/light/dark) and sets <html data-theme> so there is no light flash
// for dark-system users on first paint.
(function () {
  var t = 'system';
  try { t = localStorage.getItem('sc-theme') || 'system'; } catch (e) { /* private mode */ }
  var dark = t === 'dark' || (t === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
