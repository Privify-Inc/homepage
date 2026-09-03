/* Privify shared theme toggle — apply before paint to avoid flash */
(function () {
  var root  = document.documentElement;
  var KEY   = 'privify-theme';
  var saved = localStorage.getItem(KEY);

  /* Light is the default. Only go dark if the user explicitly chose it. */
  if (saved !== 'dark') root.setAttribute('data-theme', 'light');

  /* Wire button after DOM is ready */
  function wire() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var isLight = root.getAttribute('data-theme') === 'light';
      if (isLight) {
        root.removeAttribute('data-theme');
        localStorage.setItem(KEY, 'dark');
      } else {
        root.setAttribute('data-theme', 'light');
        localStorage.setItem(KEY, 'light');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
