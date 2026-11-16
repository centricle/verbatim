(function () {
  var btn = document.getElementById('mobile-menu-button');
  var menu = document.getElementById('mobile-menu');
  if (!btn || !menu) return;

  var iconOpen = btn.querySelector('.icon-menu');
  var iconClose = btn.querySelector('.icon-close');

  function open() {
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-label', 'Close menu');
    iconOpen.classList.add('hidden');
    iconClose.classList.remove('hidden');
    menu.querySelector('a').focus();
  }

  function close() {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Open menu');
    iconOpen.classList.remove('hidden');
    iconClose.classList.add('hidden');
    btn.focus();
  }

  btn.addEventListener('click', function () {
    menu.classList.contains('hidden') ? open() : close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !menu.classList.contains('hidden')) close();
  });

  document.addEventListener('click', function (e) {
    if (!menu.classList.contains('hidden') && !menu.contains(e.target) && !btn.contains(e.target)) close();
  });
})();

// Record menu (<details class="nav-menu">). The browser opens and closes it;
// this only adds the three ways out a menu is expected to have.
(function () {
  var menus = document.querySelectorAll('.nav-menu');
  if (!menus.length) return;

  menus.forEach(function (d) {
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && d.open) {
        d.open = false;
        d.querySelector('summary').focus();
      }
    });
    // Only when focus moves to something else: Safari does not focus a link
    // on click, so a null relatedTarget is a click inside, and closing here
    // would hide the link before the click lands. Outside clicks are below.
    d.addEventListener('focusout', function (e) {
      if (d.open && e.relatedTarget && !d.contains(e.relatedTarget)) d.open = false;
    });
  });

  document.addEventListener('click', function (e) {
    menus.forEach(function (d) {
      if (d.open && !d.contains(e.target)) d.open = false;
    });
  });
})();
