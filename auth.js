/* Mema Games — تسجيل الدخول بجوجل أو كضيف (Firebase Auth) */

const firebaseConfig = {
  apiKey: "AIzaSyCUyUxeW6NqN899x-JK3pPsfpVEqimDtjk",
  authDomain: "memagames-9bd95.firebaseapp.com",
  projectId: "memagames-9bd95",
  storageBucket: "memagames-9bd95.firebasestorage.app",
  messagingSenderId: "120281773272",
  appId: "1:120281773272:web:59cd6d632649645b3fd3ad"
};

const FB = "https://www.gstatic.com/firebasejs/13.3.0/";

// بيتستخدم في ملف الأونلاين (online.js)
let _fbResolve;
window.MEMA_FB_READY = new Promise((r) => { _fbResolve = r; });
const $ = (id) => document.getElementById(id);
const GOOGLE_SVG = '<svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';

// ---------- واجهة الدخول (بتتبني قبل ما فايربيز يحمّل) ----------
const bar = document.createElement("div");
bar.className = "auth-bar";
bar.id = "auth-bar";
document.body.appendChild(bar);

const overlay = document.createElement("div");
overlay.id = "auth-overlay";
overlay.className = "overlay hidden";
overlay.innerHTML =
  '<div class="modal">' +
    '<button class="x-btn" id="auth-close" aria-label="إغلاق">✕</button>' +
    '<h3>👋 أهلاً في Mema Games</h3>' +
    '<p>سجّل دخولك عشان تحفظ حسابك، أو العب كضيف من غير تسجيل.</p>' +
    '<button class="auth-btn google" id="auth-google">' + GOOGLE_SVG + '<span>الدخول بحساب جوجل</span></button>' +
    '<button class="auth-btn guest" id="auth-guest">🎮 العب كضيف</button>' +
    '<div class="auth-msg" id="auth-msg"></div>' +
    '<div class="auth-note">الضيف بيقدر يلعب عادي، وبعدين يربط حسابه بجوجل من الشريط اللي فوق.</div>' +
  '</div>';
document.body.appendChild(overlay);

const msg = (t) => { $("auth-msg").textContent = t || ""; };
const openModal = () => { msg(""); overlay.classList.remove("hidden"); };
const closeModal = () => {
  overlay.classList.add("hidden");
  try { localStorage.setItem("mema_auth_seen", "1"); } catch (e) {}
};
$("auth-close").onclick = closeModal;
window.MEMA_OPEN_AUTH = openModal;
overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

function render(user) {
  bar.innerHTML = "";
  if (!user) {
    const b = document.createElement("button");
    b.className = "auth-chip";
    b.innerHTML = '<span class="auth-avatar">👤</span><span>تسجيل الدخول</span>';
    b.onclick = openModal;
    bar.appendChild(b);
    return;
  }
  const guest = user.isAnonymous;
  const name = guest ? "ضيف" : (user.displayName || user.email || "لاعب");
  const chip = document.createElement("div");
  chip.className = "auth-chip";
  chip.style.cursor = "default";
  const av = user.photoURL && !guest
    ? '<img class="auth-avatar" referrerpolicy="no-referrer" src="' + user.photoURL.replace(/"/g, "") + '" alt="">'
    : '<span class="auth-avatar">' + (guest ? "🎮" : name.charAt(0).toUpperCase()) + "</span>";
  chip.innerHTML = av + '<span class="auth-name"></span>';
  chip.querySelector(".auth-name").textContent = name;   // textContent عشان الأمان
  bar.appendChild(chip);

  if (guest) {
    const link = document.createElement("button");
    link.className = "auth-chip";
    link.innerHTML = "🔗 اربط بجوجل";
    link.onclick = () => doGoogle();
    bar.appendChild(link);
  }
  const out = document.createElement("button");
  out.className = "auth-out";
  out.textContent = "خروج";
  out.onclick = () => doSignOut();
  bar.appendChild(out);
}
render(null);

// ---------- Firebase ----------
let auth, api;

function publish(user) {
  window.MEMA_USER = user
    ? { uid: user.uid, name: user.isAnonymous ? "ضيف" : (user.displayName || ""), photo: user.photoURL || "", isGuest: user.isAnonymous }
    : null;
  document.dispatchEvent(new CustomEvent("mema-auth", { detail: window.MEMA_USER }));
}

function explain(e) {
  const c = (e && e.code) || "";
  if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return "";
  if (c === "auth/network-request-failed") return "مفيش اتصال بالنت، جرّب تاني.";
  if (c === "auth/unauthorized-domain") return "الدومين ده مش مضاف في Firebase (Authorized domains).";
  if (c === "auth/operation-not-allowed") return "طريقة الدخول دي مش مفعّلة في Firebase.";
  return "حصلت مشكلة، جرّب تاني. (" + (c || "unknown") + ")";
}

async function doGoogle() {
  if (!api) return msg("لسه بيحمّل... جرّب بعد ثانية.");
  const btn = $("auth-google");
  btn.disabled = true; msg("");
  const provider = new api.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const cur = auth.currentUser;
    if (cur && cur.isAnonymous) {
      try {
        await api.linkWithPopup(cur, provider);          // نفس الحساب، بس بقى مربوط بجوجل
      } catch (e) {
        if (e.code === "auth/credential-already-in-use") {
          const cred = api.GoogleAuthProvider.credentialFromError(e);
          await api.signInWithCredential(auth, cred);     // حساب جوجل موجود قبل كده
        } else { throw e; }
      }
    } else {
      await api.signInWithPopup(auth, provider);
    }
    closeModal();
  } catch (e) {
    if (e.code === "auth/popup-blocked") {
      try { await api.signInWithRedirect(auth, provider); return; } catch (e2) { e = e2; }
    }
    msg(explain(e));
  } finally { btn.disabled = false; }
}

async function doGuest() {
  if (!api) return msg("لسه بيحمّل... جرّب بعد ثانية.");
  const btn = $("auth-guest");
  btn.disabled = true; msg("");
  try { await api.signInAnonymously(auth); closeModal(); }
  catch (e) { msg(explain(e)); }
  finally { btn.disabled = false; }
}

async function doSignOut() {
  try { await api.signOut(auth); } catch (e) {}
}

$("auth-google").onclick = doGoogle;
$("auth-guest").onclick = doGuest;

(async function init() {
  try {
    const appMod = await import(FB + "firebase-app.js");
    const authMod = await import(FB + "firebase-auth.js");
    api = authMod;
    const app = appMod.initializeApp(firebaseConfig);
    auth = authMod.getAuth(app);
    _fbResolve({ app, auth });
    auth.languageCode = "ar";
    try { await authMod.getRedirectResult(auth); } catch (e) { msg(explain(e)); }

    authMod.onAuthStateChanged(auth, (user) => {
      render(user);
      publish(user);
      if (!user) {
        let seen = false;
        try { seen = localStorage.getItem("mema_auth_seen") === "1"; } catch (e) {}
        if (!seen) setTimeout(openModal, 700);
      }
    });
  } catch (e) {
    console.warn("Firebase load failed", e);
    msg("تعذّر تحميل خدمة الدخول. اللعبة شغّالة عادي.");
    _fbResolve(null);
  }
})();

// نظام اللعب أونلاين
// online.js بيتحمل من index.html

// شاشة الافتتاح وتوقيع المطوّر
// credit.js بيتحمل من index.html
