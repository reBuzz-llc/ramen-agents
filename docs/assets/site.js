// The site's one script. Without it every page reads the same: the office is a still picture, everything is shown.
(function () {
  var d = document.documentElement;
  var R = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var save = navigator.connection && navigator.connection.saveData;
  var IO = 'IntersectionObserver' in window;
  document.addEventListener('DOMContentLoaded', function () {
    // The office: a small looping video over its still picture, only with motion on, and paused off screen.
    var v = document.querySelector('.scene video');
    if (v && !R && !save) {
      var base = matchMedia('(max-width: 859px)').matches ? v.dataset.phone : v.dataset.desk;
      var ext = v.canPlayType('video/mp4; codecs="avc1.42E01E"') ? '.mp4' : '.webm';
      v.src = base + ext;
      v.addEventListener('playing', function () { v.classList.add('on'); });
      var go = function (yes) { if (yes) { var p = v.play(); if (p) p.catch(function () {}); } else v.pause(); };
      if (IO) new IntersectionObserver(function (es) { go(es[0].isIntersecting); }).observe(v); else go(true);
    }
    // Quiet reveals as a section comes into view; all shown at once with motion off.
    var els = [].slice.call(document.querySelectorAll('[data-rv]'));
    if (R || navigator.webdriver || !IO) {
      d.classList.add('still');
      els.forEach(function (e) { e.classList.add('in'); });
    } else {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
      els.forEach(function (e) { io.observe(e); });
    }
    // On a reading page: "On this page" from its headings.
    var rail = document.querySelector('[data-toc]');
    var hs = rail ? [].slice.call(document.querySelectorAll('.prose h2[id]')) : [];
    if (hs.length > 2) {
      var h = '<p class="eyebrow">On this page</p><nav>';
      hs.forEach(function (x) { h += '<a href="#' + x.id + '">' + x.textContent + '</a>'; });
      rail.innerHTML = h + '</nav>';
      rail.classList.add('has');
    }
    // Reading-page tables: each cell learns its column's name, so a phone can show a row as a stacked card.
    [].forEach.call(document.querySelectorAll('.prose table'), function (t) {
      var names = [].map.call(t.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
      if (!names.length) return;
      [].forEach.call(t.querySelectorAll('tbody tr'), function (tr) {
        [].forEach.call(tr.children, function (td, i) { if (names[i]) td.setAttribute('data-label', names[i]); });
      });
      t.classList.add('stack');
    });
    // The phone menu closes on a link or Escape.
    var m = document.querySelector('details.menu');
    if (m) {
      m.addEventListener('click', function (e) { if (e.target.closest('a')) m.removeAttribute('open'); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && m.open) { m.removeAttribute('open'); m.querySelector('summary').focus(); }
      });
    }
  });
})();
