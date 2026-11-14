/* Mema Games — مؤثرات الـ 3D: خلفية + ميل الكروت مع الماوس/الإصبع */
(function () {
  'use strict';

  // خلفية 3D
  var bg = document.createElement('div');
  bg.className = 'bg3d';
  bg.setAttribute('aria-hidden', 'true');
  bg.innerHTML = '<div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div><div class="orb o4"></div><div class="floor"></div>';
  document.body.insertBefore(bg, document.body.firstChild);

  var MAX = 14; // أقصى زاوية ميل بالدرجات

  function tilt(card, e) {
    var r = card.getBoundingClientRect();
    var px = (e.clientX - r.left) / r.width;   // 0..1
    var py = (e.clientY - r.top) / r.height;   // 0..1
    card.style.setProperty('--ry', ((px - 0.5) * MAX * 2).toFixed(2) + 'deg');
    card.style.setProperty('--rx', ((0.5 - py) * MAX * 2).toFixed(2) + 'deg');
    card.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
    card.style.setProperty('--my', (py * 100).toFixed(1) + '%');
    card.classList.add('tilting');
  }

  function reset(card) {
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
    card.classList.remove('tilting');
  }

  document.addEventListener('pointermove', function (e) {
    var card = e.target.closest && e.target.closest('.game-card');
    if (!card) return;
    // على اللمس بنميل الكارت وقت الضغط بس
    if (e.pointerType === 'touch' && e.buttons === 0) return;
    tilt(card, e);
  }, { passive: true });

  document.addEventListener('pointerdown', function (e) {
    var card = e.target.closest && e.target.closest('.game-card');
    if (card) tilt(card, e);
  }, { passive: true });

  ['pointerup', 'pointercancel', 'pointerout'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      var card = e.target.closest && e.target.closest('.game-card');
      if (!card) return;
      if (type === 'pointerout' && card.contains(e.relatedTarget)) return;
      reset(card);
    }, { passive: true });
  });
})();
