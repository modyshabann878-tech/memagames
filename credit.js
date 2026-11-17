/* Mema Games — شاشة الافتتاح + توقيع المطوّر */
(function () {
  "use strict";
  var NAME = "محمد شعبان خليفه", PHOTO = "owner.jpg";
  var css = document.createElement("style");
  css.textContent =
    "#dev-splash{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;text-align:center;padding:20px;" +
    "background:radial-gradient(900px 600px at 50% 30%,#2a1066 0,#0b0820 70%);color:#fff;font-family:inherit;opacity:1;transition:opacity .7s,transform .7s;perspective:900px}" +
    "#dev-splash.out{opacity:0;transform:scale(1.08);pointer-events:none}" +
    "#dev-splash .pic{width:150px;height:150px;border-radius:50%;object-fit:cover;border:4px solid #fff;box-shadow:0 0 0 6px #7c3aed,0 0 50px #7c3aed99,0 20px 40px #000a;animation:devfloat 3s ease-in-out infinite,devpop .9s cubic-bezier(.2,1.4,.3,1) both}" +
    "#dev-splash small{color:#a5b4fc;letter-spacing:.5px;font-size:.95rem;animation:devup .8s .35s both}" +
    "#dev-splash h1{margin:0;font-size:clamp(1.6rem,7vw,2.4rem);font-weight:900;background:linear-gradient(90deg,#fbbf24,#f472b6,#38bdf8);-webkit-background-clip:text;background-clip:text;color:transparent;animation:devup .8s .5s both}" +
    "#dev-splash .tap{margin-top:18px;font-size:.8rem;color:#94a3b8;animation:devup .8s 1s both}" +
    "#dev-splash .bar{width:160px;height:4px;border-radius:4px;background:#ffffff22;overflow:hidden}#dev-splash .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#7c3aed,#38bdf8);animation:devbar 3.6s linear forwards}" +
    "@keyframes devfloat{50%{transform:translateY(-8px) rotateY(10deg)}}@keyframes devpop{from{transform:scale(0) rotate(-40deg);opacity:0}}" +
    "@keyframes devup{from{transform:translateY(16px);opacity:0}}@keyframes devbar{to{width:100%}}" +
    "#dev-foot{display:flex;align-items:center;justify-content:center;gap:8px;margin:26px auto 90px;padding:8px 14px;width:max-content;max-width:92vw;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);font-size:.8rem;color:#cbd5e1}" +
    "#dev-foot img{width:30px;height:30px;border-radius:50%;object-fit:cover;border:2px solid #7c3aed}#dev-foot b{color:#fbbf24}";
  document.head.appendChild(css);

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // توقيع ثابت أسفل الصفحة
  var foot = document.createElement("div");
  foot.id = "dev-foot";
  foot.innerHTML = '<img src="' + PHOTO + '" alt=""><span>تطوير: <b>' + esc(NAME) + "</b></span>";
  document.body.appendChild(foot);

  // شاشة الافتتاح: مرة في كل زيارة
  var seen = false;
  try { seen = sessionStorage.getItem("mema_splash") === "1"; } catch (e) {}
  if (seen) return;
  var sp = document.createElement("div");
  sp.id = "dev-splash";
  sp.innerHTML = '<img class="pic" src="' + PHOTO + '" alt=""><small>لعبة مطوَّرة بواسطة</small><h1>' + esc(NAME) + '</h1><div class="bar"><i></i></div><div class="tap">اضغط للدخول</div>';
  document.body.appendChild(sp);
  function close() {
    if (!sp.parentNode) return;
    sp.classList.add("out");
    try { sessionStorage.setItem("mema_splash", "1"); } catch (e) {}
    setTimeout(function () { sp.remove(); }, 750);
  }
  sp.addEventListener("click", close);
  setTimeout(close, 3600);
})();
