/* =====================================================================
   Mema Games — اللعب أونلاين (Firebase Realtime Database)
   - صاحب الغرفة (host) هو اللي بيشغّل منطق اللعبة ويكتب الحالة
   - باقي اللاعبين بيبعتوا إجاباتهم/أصواتهم في inputs/<uid>
   - الأدوار السرية بتتخزن في private/<uid> (اللاعب نفسه بس بيقراها)
   ===================================================================== */

const DB_URL = "https://memagames-9bd95-default-rtdb.europe-west1.firebasedatabase.app";
const FBV = "https://www.gstatic.com/firebasejs/13.3.0/";
if (window.__MEMA_ONLINE_LOADED__) throw new Error("online.js already loaded - skipped duplicate");
window.__MEMA_ONLINE_LOADED__ = true;
const T = window.MEMA_TEST || {};
const Q_TIME = 15000, CH_TIME = 60000, TURN_TIME = T.turn || 60000, AUTO_MS = T.auto || 15000;

const S = { api: null, db: null, auth: null, uid: null, code: null, isHost: false, offset: 0,
            room: null, priv: null, unsubs: [], clock: null, peek: false, picking: false };
let H = null;                                   // ذاكرة صاحب الغرفة (الإجابات الصح، الأدوار...)

const g = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shuf = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const now = () => Date.now() + S.offset;

/* ------------------------------ أدوات ------------------------------ */
function toast(t) {
  const d = document.createElement("div");
  d.className = "ol-toast"; d.textContent = t;
  document.body.appendChild(d);
  setTimeout(() => d.classList.add("show"), 10);
  setTimeout(() => { d.classList.remove("show"); setTimeout(() => d.remove(), 400); }, 3200);
}
const R = (p) => S.api.ref(S.db, "rooms/" + S.code + "/" + p);
const room = () => S.room || {};
const st = () => (S.room && S.room.state) || {};
const nameOf = (uid) => { const p = S.room && S.room.players && S.room.players[uid]; return p ? p.name : "لاعب"; };

function plist() {
  const p = (S.room && S.room.players) || {};
  return Object.keys(p).map((uid) => ({ uid, name: p[uid].name || "لاعب", online: p[uid].online !== false, joined: p[uid].joined || 0, voice: p[uid].voice || 0, bot: p[uid].bot === true }))
    .sort((a, b) => a.joined - b.joined || (a.uid < b.uid ? -1 : 1));
}
const active = () => plist().filter((p) => p.online);

function myName() {
  let n = "";
  try { n = localStorage.getItem("mema_name") || ""; } catch (e) {}
  if (!n && window.MEMA_USER && !window.MEMA_USER.isGuest) n = (window.MEMA_USER.name || "").split(" ")[0];
  return (n || "لاعب" + Math.floor(100 + Math.random() * 900)).slice(0, 14);
}

async function initApi() {
  const fb = await window.MEMA_FB_READY;
  if (!fb) { toast("تعذّر تحميل خدمة الأونلاين (" + (window.MEMA_FB_ERR || "?") + "). جرّب Chrome، واقفل أي VPN أو توفير بيانات."); return false; }
  let api;
  try { api = window.MEMA_DB_API || (await import(FBV + "firebase-database.js")); }
  catch (e) { console.error(e); toast("تعذّر تحميل قاعدة البيانات. تأكد من النت."); return false; }
  S.api = api; S.auth = fb.auth;
  try { S.db = api.getDatabase(fb.app, DB_URL); } catch (e) { console.error(e); toast("رابط الداتابيز غلط: " + e.message); return false; }
  api.onValue(api.ref(S.db, ".info/serverTimeOffset"), (s) => { S.offset = s.val() || 0; });
  return true;
}
async function ready() {
  if (!S.api && !(await initApi())) return false;
  if (S.auth.authStateReady) await S.auth.authStateReady();
  if (!S.auth.currentUser) {
    toast("سجّل دخولك أو العب كضيف الأول 👆");
    if (window.MEMA_OPEN_AUTH) window.MEMA_OPEN_AUTH();
    return false;
  }
  S.uid = S.auth.currentUser.uid;
  return true;
}

/* ------------------------------ الغرفة ------------------------------ */
function chData() { return cache[room().game] ? cache[room().game].challenges[room().chIndex] : null; }

function createRange() {
  const ch = curChallenge(), type = typeOf(ch), rule = RULES[type];
  return { ch, type, min: type === "quiz" ? 2 : rule.min, max: type === "quiz" ? 8 : rule.max };
}
let cMax = 4;
async function openCreate() {
  try { if (!(await ready())) return; } catch (e) { console.error(e); return toast("تعذّر تشغيل الأونلاين: " + (e.message || e)); }
  const r = createRange();
  cMax = Math.min(r.max, Math.max(r.min, cMax)); if (r.type === "basra" && cMax === 3) cMax = 4;
  renderCreate();
  g("ol-create-overlay").classList.remove("hidden");
}
function renderCreate() {
  const r = createRange();
  g("ol-create-title").textContent = r.ch.name;
  g("ol-create-hint").textContent = "الحد الأدنى للبدء: " + r.min + " لاعبين. اختار أقصى عدد يقدر يدخل الغرفة:";
  let h = "";
  for (let n = r.min; n <= r.max; n++) if (!(r.type === "basra" && n === 3)) h += `<button class="count-btn${n === cMax ? " active" : ""}" onclick="OL.setMax(${n})">${n}</button>`;
  g("ol-create-counts").innerHTML = h;
}
function confirmCreate() { g("ol-create-overlay").classList.add("hidden"); createRoom(cMax); }

async function createRoom(maxPlayers, opts) {
  const random = !!(opts && opts.random);
  if (!random) toast("جاري إنشاء الغرفة...");
  try { if (!(await ready())) return; } catch (e) { console.error(e); return toast("تعذّر تشغيل الأونلاين: " + (e.message || e)); }
  const ch = curChallenge(), type = typeOf(ch), rule = RULES[type];
  const rg = createRange(), min = rg.min, max = Math.min(rg.max, Math.max(min, maxPlayers || rg.max));
  let code = null;
  for (let i = 0; i < 12 && !code; i++) {
    const c = String(Math.floor(1000 + Math.random() * 9000));
    let s;
    try { s = await S.api.get(S.api.ref(S.db, "rooms/" + c + "/public")); }
    catch (e) { console.error(e); return toast("تعذّر الاتصال بقاعدة البيانات (" + (e.code || e.message) + "). تأكد من نشر القواعد ومن رابط الداتابيز."); }
    if (!s.exists()) code = c;
  }
  if (!code) return toast("حصلت مشكلة، جرّب تاني.");
  S.code = code; S.isHost = true; H = null; S.lobbyKey = gameKey + "_" + chIndex; S.starting = false; S.lastCount = null;
  const nm = myName();
  try { localStorage.setItem("mema_name", nm); } catch (e) {}
  try {
    await S.api.set(R("public"), {
      host: S.uid, game: gameKey, chIndex, chName: ch.name, type, min, max, status: "lobby", random, lobbyKey: S.lobbyKey,
      state: { phase: "lobby", step: 0 },
      players: { [S.uid]: { name: nm, online: true, joined: Date.now() } }
    });
  } catch (e) { console.error(e); S.code = null; return toast("تعذّر إنشاء الغرفة (" + (e.code || e.message) + "). تأكد من قواعد Firebase."); }
  if (random) S.api.set(lobbyRef(), { host: S.uid, count: 1, min, max, createdAt: Date.now(), chName: ch.name }).catch(() => {});
  keepSession(); subscribe();
  return true;
}

function lobbyRef() { return S.api.ref(S.db, "lobbies/" + S.lobbyKey + "/" + S.code); }
function dropLobby() { if (S.isHost && S.lobbyKey && S.code) S.api.remove(lobbyRef()).catch(() => {}); }

async function joinRoom(code, silent) {
  if (!(await ready())) return false;
  code = String(code || "").trim();
  if (!/^\d{4}$/.test(code)) { toast("اكتب كود الغرفة (4 أرقام)."); return false; }
  let r;
  try { r = (await S.api.get(S.api.ref(S.db, "rooms/" + code + "/public"))).val(); }
  catch (e) { if (!silent) toast("تعذّر الوصول للغرفة."); return false; }
  if (!r) { if (silent) clearSession(); else toast("الغرفة دي مش موجودة. اتأكد من الكود."); return false; }
  const mine = r.players && r.players[S.uid];
  if (r.host === S.uid) { S.code = code; await closeRoom(); S.code = null; if (!silent) toast("الغرفة اتقفلت."); return false; }
  if (!mine) {
    const h = r.players && r.players[r.host];
    if (r.random && (!h || h.online === false)) return false;                // غرفة عشوائية صاحبها مش متصل
    if (r.status !== "lobby") { if (!silent) toast("اللعبة بدأت بالفعل."); return false; }
    if (Object.keys(r.players || {}).length >= r.max) { if (!silent) toast("الغرفة مليانة."); return false; }
  }
  S.code = code; S.isHost = false; H = null;
  const nm = mine ? mine.name : myName();
  try {
    await S.api.set(R("public/players/" + S.uid), { name: nm, online: true, joined: mine ? mine.joined : Date.now() });
  } catch (e) { S.code = null; if (!silent) toast("تعذّر الدخول للغرفة."); return false; }
  g("ol-join-overlay").classList.add("hidden");
  keepSession(); subscribe();
  return true;
}

async function quickMatch() {
  if (!(await ready())) return;
  const key = gameKey + "_" + chIndex;
  toast("بندوّر على لاعبين... 🔍");
  let list = {};
  try { list = (await S.api.get(S.api.ref(S.db, "lobbies/" + key))).val() || {}; } catch (e) {}
  const cands = Object.keys(list).map((c) => Object.assign({ code: c }, list[c]))
    .filter((x) => x.host !== S.uid && Date.now() - (x.createdAt || 0) < 15 * 60 * 1000 && (x.count || 0) < (x.max || 0))
    .sort((a, b) => (b.count || 0) - (a.count || 0) || a.createdAt - b.createdAt);
  for (const c of cands) { if (await joinRoom(c.code, true)) return; }
  await createRoom(null, { random: true });
}

function keepSession() { try { sessionStorage.setItem("mema_room", JSON.stringify({ code: S.code, host: S.isHost })); } catch (e) {} }
function clearSession() { try { sessionStorage.removeItem("mema_room"); } catch (e) {} }

function subscribe() {
  const a = S.api;
  S.unsubs.push(a.onValue(R("public"), (snap) => {
    S.room = snap.val();
    if (!S.room) { if (!S.leaving) toast("الغرفة اتقفلت."); return teardown(true); }
    if (S.isHost && H) hostTick();
    if (S.isHost) lobbyUpkeep();
    renderRoom();
    voiceSync();
  }));
  S.unsubs.push(a.onValue(a.ref(S.db, "rooms/" + S.code + "/private/" + S.uid), (snap) => { S.priv = snap.val(); renderRoom(); }));
  S.unsubs.push(a.onValue(a.ref(S.db, ".info/connected"), (snap) => {      // حضور اللاعب
    if (!snap.val() || !S.code) return;
    const pr = R("public/players/" + S.uid + "/online");
    a.onDisconnect(pr).set(false);
    a.set(pr, true).catch(() => {});
  }));
  show("online-view");
  clearInterval(S.clock); S.clock = setInterval(tickClock, 250);
}

function teardown(goHome) {
  voiceLeave(true);
  S.unsubs.forEach((u) => { try { u(); } catch (e) {} }); S.unsubs = [];
  clearInterval(S.clock); if (H && H.timer) clearTimeout(H.timer);
  H = null; S.room = null; S.priv = null; S.code = null; S.isHost = false; S.peek = false; S.picking = false; S.leaving = false; S.lastKey = null; clearTimeout(S.autoT); S.autoT = null; S.lobbyKey = null; S.starting = false; S.lastCount = null;
  clearSession(); voiceBar();
  if (goHome) { try { goHome === true && window.goHome(); } catch (e) {} }
}

async function closeRoom() {
  if (!S.code) return;
  const upd = { public: null, voice: null, rtc: null };
  try {
    const rr = S.room || (await S.api.get(R("public"))).val();
    if (rr && rr.lobbyKey) await S.api.remove(S.api.ref(S.db, "lobbies/" + rr.lobbyKey + "/" + S.code));
  } catch (e) {}
  try {
    // الأدوار السرية: بنمسح كل لاعب لوحده
    const pl = (S.room && S.room.players) || (await S.api.get(R("public/players"))).val() || {};
    Object.keys(pl).forEach((u) => { upd["private/" + u] = null; });
  } catch (e) {}
  try { await S.api.update(S.api.ref(S.db, "rooms/" + S.code), upd); } catch (e) {}
}

async function leave() {
  if (!confirm(S.isHost ? "لو خرجت هتتقفل الغرفة للكل. تخرج؟" : "تخرج من الغرفة؟")) return;
  const code = S.code, host = S.isHost; S.leaving = true;
  if (host) await closeRoom();
  else { try { await S.api.update(S.api.ref(S.db, "rooms/" + code), { ["public/players/" + S.uid]: null, ["public/inputs/" + S.uid]: null, ["private/" + S.uid]: null }); } catch (e) {} }
  teardown(true);
}

async function rename(v) {
  v = String(v || "").trim().slice(0, 14); if (!v) return;
  try { localStorage.setItem("mema_name", v); } catch (e) {}
  S.api.set(R("public/players/" + S.uid + "/name"), v).catch(() => {});
}

async function share() {
  const url = location.origin + location.pathname + "?room=" + S.code;
  const text = "تعالى العب معايا في Mema Games! كود الغرفة: " + S.code;
  try { if (navigator.share) return await navigator.share({ title: "Mema Games", text, url }); } catch (e) { return; }
  try { await navigator.clipboard.writeText(text + "\n" + url); toast("اتنسخ الرابط ✅"); } catch (e) { prompt("انسخ الرابط:", url); }
}

/* --------------------------- إرسال المدخلات --------------------------- */
function sendInput(val) {
  S.api.set(R("public/inputs/" + S.uid), { step: st().step, val, t: now() }).catch(() => toast("تعذّر الإرسال، جرّب تاني."));
}
function inputsNow() {
  const inp = room().inputs || {}, out = {};
  Object.keys(inp).forEach((u) => { if (inp[u] && inp[u].step === (H ? H.step : st().step)) out[u] = inp[u]; });
  return out;
}
function myInput() { const i = (room().inputs || {})[S.uid]; return i && i.step === st().step ? i.val : undefined; }

/* =============================== منطق صاحب الغرفة =============================== */
function base(type, extra) { return Object.assign({ type, step: st().step || 0, timer: null }, extra); }
async function pushState(state, priv) {
  H.step++; state.step = H.step;
  const upd = { "public/state": state };
  if (priv) Object.keys(priv).forEach((k) => { upd["private/" + k] = priv[k]; });
  await S.api.update(S.api.ref(S.db, "rooms/" + S.code), upd);
}
function after(ms, fn) {
  clearTimeout(H.timer); const s = H.step;
  H.timer = setTimeout(() => { if (H && H.step === s) fn(); }, ms + 60);
}

function lobbyUpkeep() {
  const r = room(); if (!r.random || r.status !== "lobby") return;
  const n = active().length;
  if (S.lastCount !== n) { S.lastCount = n; S.api.update(lobbyRef(), { count: n }).catch(() => {}); }
  if (n >= r.max) { clearTimeout(S.autoT); S.autoT = null; return hostStart(); }
  if (n >= r.min && !r.autoAt && !S.autoT) {
    S.api.update(R("public"), { autoAt: now() + AUTO_MS });
    S.autoT = setTimeout(() => {
      S.autoT = null;
      if (!room() || room().status !== "lobby") return;
      if (active().length >= room().min) hostStart(); else S.api.update(R("public"), { autoAt: null });
    }, AUTO_MS + 100);
  } else if (n < r.min && (r.autoAt || S.autoT)) {
    clearTimeout(S.autoT); S.autoT = null; S.api.update(R("public"), { autoAt: null });
  }
}

async function hostStart() {
  if (S.starting) return;
  const r = room(), a = active();
  if (a.length < r.min) return toast("محتاج " + r.min + " لاعبين على الأقل.");
  if (r.type === "basra" && a.length === 3) return toast("بصرة: العدد لازم يبقى 2 أو 4 لاعبين.");
  S.starting = true;
  if (!["scro", "shayeb", "basra"].includes(r.type)) {
    if (!chData()) { await loadGame(r.game); }
    if (!chData()) { S.starting = false; return toast("تعذّر تحميل بيانات اللعبة."); }
  }
  dropLobby(); clearTimeout(S.autoT); S.autoT = null;
  await S.api.update(R("public"), { status: "playing", autoAt: null });
  ({ quiz: qzStart, imposter: impStart, mafioso: mfStart, charades: chStart, scro: scStart, shayeb: shStart, basra: bsStart }[r.type])();
}

function hostTick() {
  if (!H || st().step !== H.step) return;
  const ph = st().phase, inp = inputsNow(), act = active();
  if (H.type === "quiz" && ph === "q") {
    const qq = H.qs[H.i];
    if (act.some((p) => (inp[p.uid] || {}).val === qq.ci) || (act.length && act.every((p) => typeof (inp[p.uid] || {}).val === "number"))) qzReveal();
  } else if (H.type === "imposter") {
    const parts = act.filter((p) => H.parts.includes(p.uid));
    if (ph === "reveal" && parts.length && parts.every((p) => inp[p.uid])) impDiscuss();
    if (ph === "discuss") { const v = (inp[H.order[H.idx]] || {}).val; if (v && v.t === "done") turnNext(); }
    if (ph === "vote" && parts.length && parts.every((p) => inp[p.uid] && typeof inp[p.uid].val === "string")) impResult();
  } else if (H.type === "mafioso") {
    const parts = act.filter((p) => H.parts.includes(p.uid));
    if (ph === "reveal" && parts.length && parts.every((p) => inp[p.uid])) mfRound();
    if (ph === "round") { const v = (inp[H.order[H.idx]] || {}).val; if (v && v.t === "done") turnNext(); }
    if (ph === "vote") {
      const voters = parts.filter((p) => H.alive[p.uid]);
      if (voters.length && voters.every((p) => inp[p.uid] && typeof inp[p.uid].val === "string")) mfOut();
    }
  } else if (H.type === "scro") {
    scTick();
  } else if (H.type === "shayeb" || H.type === "basra") {
    cardsTick();
  } else if (H.type === "charades" && ph === "act") {
    const i = inp[H.actor], v = i && i.val;
    if (v && v.n > H.lastN) {
      H.lastN = v.n;
      if (v.t === "skip") {
        H.used++; H.cur = H.titles[H.used % H.titles.length];
        S.api.set(S.api.ref(S.db, "rooms/" + S.code + "/private/" + H.actor), { title: H.cur });
      } else if (v.t === "guessed" && H.order.includes(v.g) && v.g !== H.actor) {
        H.scores[H.actor] = (H.scores[H.actor] || 0) + 1; H.scores[v.g] = (H.scores[v.g] || 0) + 1;
        chEndTurn("🎉 تمام! +1 للممثل و+1 لـ " + nameOf(v.g));
      }
    }
  }
}

function hostForce() {
  if (!S.isHost || !H) return;
  const ph = st().phase; clearTimeout(H.timer);
  if (H.type === "quiz" && ph === "q") qzReveal();
  else if (H.type === "imposter") { if (ph === "reveal") impDiscuss(); else if (ph === "discuss") impVote(); else if (ph === "vote") impResult(); }
  else if (H.type === "mafioso") { if (ph === "reveal") mfRound(); else if (ph === "round") mfVote(); else if (ph === "vote") mfOut(); }
  else if (H.type === "shayeb") { if (ph === "play") shDraw(Math.floor(Math.random() * H.hands[H.target].length)); }
  else if (H.type === "basra") { if (ph === "play") bsPlay(bsPick(H.hands[H.cur], H.table)); else if (ph === "roundEnd") bsNext(); }
  else if (H.type === "scro") { if (ph === "peek") scPeekShow(); else if (ph === "peekshow") scBegin(); else if (ph === "turn") scTimeout(); else if (ph === "roundEnd") scNextRound(); }
  else if (H.type === "charades" && ph === "act") chEndTurn("⏭ صاحب الغرفة أنهى الدور. الفيلم كان: " + H.cur);
}
function hostNext() { if (S.isHost && H && (st().phase === "discuss" || st().phase === "round")) turnNext(); }
function hostAgain() {
  if (!S.isHost) return;
  const a = active(); if (a.length < room().min) return toast("محتاج " + room().min + " لاعبين على الأقل.");
  ({ quiz: qzStart, imposter: impStart, mafioso: mfStart, charades: chStart, scro: scStart, shayeb: shStart, basra: bsStart }[room().type])();
}

/* ------------------------------- كويز ------------------------------- */
async function qzStart() {
  const ch = chData();
  const qs = shuf(ch.questions).slice(0, 10).map((q) => {
    const opts = shuf(q.options); let ci = opts.indexOf(q.correct_answer);
    if (ci < 0) { opts.push(q.correct_answer); ci = opts.length - 1; }
    return { text: q.question, diff: q.difficulty || "", opts, ci };
  });
  H = base("quiz", { qs, i: 0, scores: {} });
  plist().forEach((p) => { H.scores[p.uid] = 0; });
  await qzAsk();
}
async function qzAsk() {
  const q = H.qs[H.i]; H.endsAt = now() + Q_TIME;
  await pushState({ phase: "q", i: H.i, total: H.qs.length, text: q.text, diff: q.diff, opts: q.opts, endsAt: H.endsAt, scores: H.scores });
  after(Q_TIME, qzReveal);
}
async function qzReveal() {
  clearTimeout(H.timer);
  const q = H.qs[H.i], inp = inputsNow(), picks = {}, gained = {};
  let win = null;
  Object.keys(inp).forEach((u) => {
    const idx = inp[u].val; if (typeof idx !== "number") return;
    picks[u] = idx;
    // الأسرع في الإجابة الصح هو اللي ياخد النقطة (بالوقت)
    if (idx === q.ci && (win === null || inp[u].t < inp[win].t)) win = u;
  });
  if (win) { gained[win] = 1; H.scores[win] = (H.scores[win] || 0) + 1; }
  await pushState({ phase: "reveal", i: H.i, total: H.qs.length, text: q.text, opts: q.opts, correct: q.ci, picks, gained, winner: win, scores: H.scores, endsAt: now() + 3500 });
  after(3500, async () => { H.i++; if (H.i >= H.qs.length) await pushState({ phase: "end", scores: H.scores }); else await qzAsk(); });
}

/* ---------------- شات بالدور (Imposter + المافيوسو): دقيقة لكل لاعب ---------------- */
const isOnline = (u) => { const p = (room().players || {})[u]; return !!p && p.online !== false; };
async function turnStart() {
  H.cid = Date.now();
  H.order = H.parts.filter((u) => isOnline(u) && (H.type !== "mafioso" || H.alive[u]));
  H.idx = 0;
  await turnPush();
}
function turnBase() {
  if (H.type === "imposter") return { phase: "discuss", cat: H.cat, parts: H.parts };
  return { phase: "round", round: H.round, title: H.sc.title, clue: H.clue, roster: H.roster, parts: H.parts };
}
async function turnPush() {
  while (H.idx < H.order.length && !isOnline(H.order[H.idx])) H.idx++;
  if (H.idx >= H.order.length) return H.type === "imposter" ? impVote() : mfVote();
  H.endsAt = now() + TURN_TIME;
  await pushState(Object.assign(turnBase(), { cid: H.cid, order: H.order, idx: H.idx, endsAt: H.endsAt }));
  after(TURN_TIME, turnNext);
}
async function turnNext() { clearTimeout(H.timer); H.idx++; await turnPush(); }

/* ------------------------------ Imposter ------------------------------ */
async function impStart() {
  const ch = chData(), ps = active();
  const word = pick(ch.words), imp = pick(ps).uid;
  H = base("imposter", { word, imp, cat: ch.name, parts: ps.map((p) => p.uid) });
  const priv = {};
  try { await S.api.remove(R("public/chat")); } catch (e) {}
  ps.forEach((p) => { priv[p.uid] = p.uid === imp ? { role: "imp", cat: ch.name } : { role: "civ", cat: ch.name, word }; });
  await pushState({ phase: "reveal", cat: ch.name, parts: H.parts }, priv);
}
async function impDiscuss() { clearTimeout(H.timer); await turnStart(); }
async function impVote() { clearTimeout(H.timer); await pushState({ phase: "vote", cat: H.cat, parts: H.parts, cid: H.cid, order: H.order }); }
async function impResult() {
  clearTimeout(H.timer);
  const inp = inputsNow(), tally = {}, votes = {};
  H.parts.forEach((u) => { const v = inp[u] && inp[u].val; if (typeof v === "string" && v !== u && H.parts.includes(v)) { votes[u] = v; tally[v] = (tally[v] || 0) + 1; } });
  const max = Math.max(0, ...Object.values(tally)), top = Object.keys(tally).filter((u) => tally[u] === max);
  const caught = max > 0 && top.length === 1 && top[0] === H.imp;
  await pushState({ phase: "result", cat: H.cat, parts: H.parts, imp: H.imp, impName: nameOf(H.imp), word: H.word, caught, tally, votes });
}

/* ------------------------------ المافيوسو ------------------------------ */
async function mfStart() {
  const ch = chData(), ps = active(), n = ps.length, sc = pick(ch.scenarios);
  const roles = shuf(sc.roles || []).slice(0, n); while (roles.length < n) roles.push("شخصية " + (roles.length + 1));
  const bad = shuf(ps.map((p) => p.uid)).slice(0, MAF_COUNT[n] || 1);
  H = base("mafioso", { sc, bad, alive: {}, round: 0, parts: ps.map((p) => p.uid) });
  const priv = {}, roster = {};
  ps.forEach((p, i) => {
    H.alive[p.uid] = true; roster[p.uid] = { name: p.name, role: roles[i], alive: true };
    priv[p.uid] = { role: roles[i], mafia: bad.includes(p.uid), mates: bad.filter((x) => x !== p.uid).map(nameOf), text: sc.mafia_text || "" };
  });
  H.roster = roster;
  try { await S.api.remove(R("public/chat")); } catch (e) {}
  await pushState({ phase: "reveal", title: sc.title, story: sc.story, count: bad.length, roster, parts: H.parts }, priv);
}
async function mfRound() {
  clearTimeout(H.timer); H.round++;
  const clues = H.sc.clues || [""]; H.clue = clues[Math.min(H.round - 1, clues.length - 1)];
  await turnStart();
}
async function mfVote() { clearTimeout(H.timer); await pushState({ phase: "vote", round: H.round, roster: H.roster, parts: H.parts, cid: H.cid, order: H.order }); }
async function mfOut() {
  clearTimeout(H.timer);
  const inp = inputsNow(), tally = {};
  H.parts.forEach((u) => { const v = inp[u] && inp[u].val; if (H.alive[u] && typeof v === "string" && v !== u && H.alive[v]) tally[v] = (tally[v] || 0) + 1; });
  const max = Math.max(0, ...Object.values(tally)), top = Object.keys(tally).filter((u) => tally[u] === max);
  const out = max > 0 ? pick(top) : null, tied = top.length > 1;
  if (out) { H.alive[out] = false; H.roster[out].alive = false; }
  await pushState({ phase: "out", round: H.round, out, outName: out ? H.roster[out].name : "", outRole: out ? H.roster[out].role : "", wasMafia: !!(out && H.bad.includes(out)), tied, roster: H.roster, parts: H.parts, endsAt: now() + 4500 });
  after(4500, mfCheck);
}
async function mfCheck() {
  const am = H.bad.filter((u) => H.alive[u]).length, ai = H.parts.filter((u) => H.alive[u] && !H.bad.includes(u)).length;
  if (am === 0) return mfEnd(true);
  if (ai < am) return mfEnd(false);
  return mfRound();
}
async function mfEnd(win) { await pushState({ phase: "end", win, roster: H.roster, bad: H.bad, parts: H.parts }); }

/* ---------------------------- التمثيل الصامت ---------------------------- */
async function chStart() {
  const ch = chData(), ps = active();
  H = base("charades", { titles: shuf(ch.titles), used: 0, t: 0, order: ps.map((p) => p.uid), scores: {}, lastN: -1, cur: "", prevActor: null });
  H.turns = H.order.length * 2; H.order.forEach((u) => { H.scores[u] = 0; });
  await chTurn();
}
async function chTurn() {
  if (H.t >= H.turns) { const pv = {}; if (H.prevActor) pv[H.prevActor] = null; return pushState({ phase: "end", scores: H.scores, order: H.order }, pv); }
  const actor = H.order[H.t % H.order.length];
  H.actor = actor; H.cur = H.titles[H.used % H.titles.length]; H.lastN = -1; H.endsAt = now() + CH_TIME;
  const priv = {}; if (H.prevActor && H.prevActor !== actor) priv[H.prevActor] = null; priv[actor] = { title: H.cur };
  await pushState({ phase: "act", t: H.t, turns: H.turns, actor, endsAt: H.endsAt, scores: H.scores, order: H.order }, priv);
  H.prevActor = actor;
  after(CH_TIME, () => chEndTurn("⏰ انتهى الوقت! الفيلم كان: " + H.cur));
}
async function chEndTurn(msg) {
  clearTimeout(H.timer); H.used++; H.t++;
  await pushState({ phase: "turnEnd", msg, t: H.t, turns: H.turns, scores: H.scores, order: H.order, endsAt: now() + 3500 });
  after(3500, chTurn);
}

/* =============================== واجهة اللاعب =============================== */
function fmt(ms, mmss) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return mmss ? Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") : String(s);
}
function tickClock() {
  const el = g("ol-timer"); if (!el) return;
  const end = +el.dataset.end, left = end - now();
  el.textContent = fmt(left, el.dataset.fmt === "ms");
  el.classList.toggle("low", left <= (el.dataset.fmt === "ms" ? 30000 : 5000));
}
const timerHtml = (end, f) => `<div class="timer" id="ol-timer" data-end="${end}" data-fmt="${f || "s"}">…</div>`;

function scoreBoard(scores, order) {
  scores = scores || {};
  const ids = order || plist().map((p) => p.uid);
  return `<div class="scoreboard">` + ids.slice().sort((a, b) => (scores[b] || 0) - (scores[a] || 0))
    .map((u) => `<span class="chip${u === S.uid ? " turn" : ""}">${esc(nameOf(u))}: ${scores[u] || 0}</span>`).join("") + `</div>`;
}
function rankList(scores, ids) {
  scores = scores || {};
  const arr = (ids || plist().map((p) => p.uid)).slice().sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
  const top = arr.length ? scores[arr[0]] || 0 : 0;
  return arr.map((u, i) => `<div class="rank-row${(scores[u] || 0) === top && top > 0 ? " first" : ""}"><span>${(scores[u] || 0) === top && top > 0 ? "🏆 " : i + 1 + ". "}${esc(nameOf(u))}${u === S.uid ? " (أنت)" : ""}</span><span>${scores[u] || 0}</span></div>`).join("");
}
const hostBtn = (label) => S.isHost ? `<div class="center"><button class="ghost-btn" onclick="OL.force()">${label}</button></div>` : "";
function endButtons() {
  return `<div class="center" style="margin-top:14px">` +
    (S.isHost ? `<button class="primary-btn" onclick="OL.again()">🔁 جولة جديدة</button>` : `<p class="muted">في انتظار صاحب الغرفة لجولة جديدة...</p>`) +
    `<button class="ghost-btn" onclick="OL.leave()">خروج</button></div>`;
}

function renderRoom() {
  const v = g("online-view"); if (!v || !S.room || !S.code) return;
  const r = room(), s = st(), ph = s.phase || "lobby";
  const keepIds = ["ol-name", "ol-msg"], saved = {};
  keepIds.forEach((id) => { const e = g(id); if (e) saved[id] = { v: e.value, f: document.activeElement === e, p: e.selectionStart }; });
  const key = ph + ":" + s.step; if (S.lastKey !== key) { S.lastKey = key; S.peek = false; S.picking = false; U = newU(); }
  let body = "";
  if (ph === "lobby" || r.status === "lobby") body = vLobby();
  else if (r.type === "quiz") body = vQuiz(s, ph);
  else if (r.type === "imposter") body = vImp(s, ph);
  else if (r.type === "mafioso") body = vMaf(s, ph);
  else if (r.type === "charades") body = vCh(s, ph);
  else if (r.type === "scro") body = vScro(s, ph);
  else if (r.type === "shayeb") body = vShayeb(s, ph);
  else if (r.type === "basra") body = vBasra(s, ph);
  v.innerHTML = `<button class="back-btn" onclick="OL.leave()">← خروج من الغرفة</button>
    <span class="chip" style="margin-inline-start:8px">🔑 ${esc(S.code)}</span>` + body;
  keepIds.forEach((id) => { const e = g(id), k = saved[id]; if (e && k) { e.value = k.v; if (k.f) { e.focus(); try { e.setSelectionRange(k.p, k.p); } catch (x) {} } } });
  const cb = g("ol-chat"); if (cb) cb.scrollTop = cb.scrollHeight;
  tickClock();
}

function chatBox(s) {
  const ord = s.order || [];
  const ms = Object.values(room().chat || {}).filter((m) => m && m.cid === s.cid && ord[m.idx] === m.uid).sort((a, b) => a.t - b.t);
  return `<div class="ol-chat" id="ol-chat">` + (ms.length
    ? ms.map((m) => `<div class="ol-msg${m.uid === S.uid ? " me" : ""}"><b>${esc(nameOf(m.uid))}</b><span>${esc(m.text)}</span></div>`).join("")
    : `<p class="muted center">ما حدش اتكلم لسه...</p>`) + `</div>`;
}
function turnPanel(s) {
  const ord = s.order || [], cur = ord[s.idx], me = cur === S.uid;
  const chips = `<div class="scoreboard">` + ord.map((u, i) => `<span class="chip${i === s.idx ? " turn" : ""}${i < s.idx ? " dead" : ""}">${i + 1}. ${esc(nameOf(u))}</span>`).join("") + `</div>`;
  const head = me
    ? `<div class="big-card"><p>🎤 دورك! اتكلم بحرية — عندك دقيقة</p>${timerHtml(s.endsAt)}</div>`
    : `<div class="big-card"><p>🎤 دور</p><div class="big-word" style="font-size:1.8rem">${esc(nameOf(cur))}</div>${timerHtml(s.endsAt)}</div>`;
  const input = me
    ? `<textarea id="ol-msg" class="name-input" rows="2" maxlength="200" placeholder="اكتب اللي عايز تقوله... (اتهم، دافع، اسأل، اشرح)" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();OL.say()}"></textarea>
       <div class="center"><button class="primary-btn" onclick="OL.say()">إرسال 💬</button><button class="ghost-btn" onclick="OL.done()">✅ خلّصت كلامي</button></div>` : "";
  return chips + head + chatBox(s) + input;
}
const hostTurnBtns = () => S.isHost ? `<div class="center"><button class="ghost-btn" onclick="OL.next()">⏭ الدور اللي بعده</button><button class="ghost-btn" onclick="OL.force()">🗳️ ابدأ التصويت</button></div>` : "";

function vLobby() {
  const r = room(), ps = plist(), n = ps.filter((p) => p.online).length, can = n >= r.min;
  const lines = ps.map((p) => `<div class="rank-row"><span>${p.uid === r.host ? "👑 " : ""}${esc(p.name)}${p.uid === S.uid ? " (أنت)" : ""}</span><span>${p.bot ? (S.isHost ? `<button class="x-mini" onclick="OL.delBot('${esc(p.uid)}')">✖ شيل</button>` : "🤖") : p.online ? "🟢" : "⚪ غير متصل"}</span></div>`).join("");
  return `<h2 style="color:#38bdf8;margin:14px 0 4px">${esc(r.chName)}</h2>
    <p class="muted">${esc(RULES[r.type].text)}</p>${r.type === "scro" ? `<p class="muted" style="font-size:.78rem;line-height:1.7">⚠️ هذه اللعبة مجرد محاكاة للعبة «سكرو» ولا يتم التربح منها، وهي نسخة للمرح بين الأصدقاء. حقوق الملكية الفكرية للعبة الورقية الأصلية، ولـ«يحيى عزام» أول من أطلقها عبر الإنترنت.</p>` : ""}
    ${r.random ? `<p class="muted">🌍 غرفة عشوائية — أي لاعب بيدوّر على لعبة هينضم.</p>` : ""}
    ${r.autoAt ? `<div class="big-card"><p>⏱ اللعبة هتبدأ تلقائياً بعد</p>${timerHtml(r.autoAt)}</div>` : ""}
    <div class="big-card"><p>كود الغرفة — ابعته لأصحابك</p><div class="big-word ol-code">${esc(S.code)}</div>
      <button class="ghost-btn" onclick="OL.share()">📤 شارك الرابط</button></div>
    <label class="muted">اسمك في اللعبة:</label>
    <input class="name-input" id="ol-name" maxlength="14" value="${esc(((room().players || {})[S.uid] || {}).name || "")}" onchange="OL.rename(this.value)">
    <h3 style="margin:14px 0 8px">اللاعبين (${ps.length}/${r.max})</h3>${lines}
    ${S.isHost && hasBots(r.type) && ps.length < r.max ? `<div class="center"><button class="ghost-btn" onclick="OL.addBot()">🤖 ضيف بوت</button></div>` : ""}
    <div class="center" style="margin-top:12px">` +
    (S.isHost ? `<button class="primary-btn" ${can ? "" : "disabled"} onclick="OL.start()">ابدأ اللعب 🚀</button>${can ? "" : `<p class="muted" style="margin-top:8px">محتاج ${r.min} لاعبين على الأقل.</p>`}`
              : `<p class="muted">⏳ في انتظار صاحب الغرفة يبدأ اللعبة...</p>`) + `</div>`;
}

function vQuiz(s, ph) {
  if (ph === "end") return `<h2 class="center" style="color:#38bdf8;margin:14px 0">🏁 النتيجة النهائية</h2>${rankList(s.scores)}${endButtons()}`;
  const mine = ph === "q" ? myInput() : (s.picks || {})[S.uid];
  const head = `<div class="score-display" style="margin-top:14px">السؤال ${s.i + 1} من ${s.total}</div>${scoreBoard(s.scores)}`;
  let opts = (s.opts || []).map((o, i) => {
    let cls = "option-btn";
    if (ph === "reveal") { if (i === s.correct) cls += " correct"; else if (i === mine) cls += " wrong"; }
    else if (i === mine) cls += " picked";
    return `<button class="${cls}" ${ph === "q" && mine === undefined ? `onclick="OL.answer(${i})"` : "disabled"}>${esc(o)}</button>`;
  }).join("");
  let foot = "";
  if (ph === "q") {
    const answered = Object.values(inputsNowView()).filter((x) => typeof x.val === "number").length;
    foot = (mine === undefined ? `<p class="muted center">⚡ أول واحد يجاوب صح ياخد النقطة!</p>` : `<p class="muted center">✅ إجابتك اتسجّلت. لو صح وكنت الأسرع النقطة ليك (${answered}/${active().length} جاوبوا)</p>`) + hostBtn("⏭ أنهِ السؤال");
  } else {
    const gained = (s.gained || {})[S.uid];
    const wl = s.winner ? `🏅 الأسرع: ${esc(nameOf(s.winner))}` : "ولا حد جاوب صح";
    foot = `<p class="center" style="margin-top:8px">${wl}${gained ? " — 🎯 +1 نقطة ليك!" : mine === undefined ? " | ⏰ ما جاوبتش" : mine === s.correct ? " | ✅ إجابتك صح بس حد كان أسرع" : " | ❌ إجابتك غلط"}</p>`;
  }
  return head + `<div class="question-box"><h3>${s.diff ? "[" + esc(s.diff) + "] " : ""}${esc(s.text)}</h3>
    ${ph === "q" ? timerHtml(s.endsAt) : ""}<div class="options-grid">${opts}</div></div>` + foot;
}
function inputsNowView() { const inp = room().inputs || {}, o = {}; Object.keys(inp).forEach((u) => { if (inp[u] && inp[u].step === st().step) o[u] = inp[u]; }); return o; }

function vImp(s, ph) {
  const P = S.priv, parts = s.parts || [];
  if (ph === "result") {
    const votes = s.votes || {}, tally = s.tally || {};
    const rows = parts.map((u) => `<div class="rank-row"><span>${esc(nameOf(u))}${u === s.imp ? " 🕵️" : ""}</span><span>${tally[u] || 0} صوت</span></div>`).join("");
    return `<div class="big-card" style="margin-top:14px">` + (s.caught
      ? `<div class="big-word" style="color:#22c55e">🎉 كشفتوا المخادع!</div>`
      : `<div class="big-word" style="color:#ef4444">😈 المخادع نجح!</div>`) +
      `<p>المخادع: <b>${esc(s.impName)}</b></p><p style="margin-top:10px">الكلمة كانت: <b style="color:#facc15">${esc(s.word)}</b></p></div>${rows}${endButtons()}`;
  }
  const ready = !!myInput();
  if (ph === "reveal") {
    if (!P) return `<p class="muted center" style="margin-top:20px">جاري توزيع الأدوار...</p>`;
    const n = Object.keys(inputsNowView()).length;
    if (ready) return `<div class="big-card" style="margin-top:14px"><div class="big-word">✅ تمام</div><p class="muted">استنى باقي اللاعبين (${n}/${parts.length})</p></div>${hostBtn("ابدأ النقاش حالاً")}`;
    return `<div class="big-card" style="margin-top:14px">` + (P.role === "imp"
      ? `<div class="big-word" style="color:#ef4444">🕵️ أنت المخادع!</div><p>الفئة: <b>${esc(P.cat)}</b></p><p class="muted">اتظاهر إنك عارف الكلمة ومتتكشفش.</p>`
      : `<p>الفئة: <b>${esc(P.cat)}</b></p><p>الكلمة السرية:</p><div class="big-word">${esc(P.word)}</div>`) +
      `</div><div class="center"><button class="primary-btn" onclick="OL.ready()">تمام، أخفِ الشاشة ✅</button></div>`;
  }
  if (ph === "discuss") {
    const mine = P ? (P.role === "imp" ? "🕵️ أنت المخادع" : "الكلمة: " + esc(P.word)) : "";
    return `<p class="muted" style="margin-top:12px">💬 النقاش — الفئة: <b>${esc(s.cat)}</b>. كل واحد يتكلم دقيقة. اسأل واتكلم من غير ما تقول الكلمة. المخادع لازم يتخفّى!</p>
      ${turnPanel(s)}<div class="center"><button class="ghost-btn" onclick="OL.peek()">👀 ${S.peek ? mine : "فكّرني بدوري"}</button></div>${hostTurnBtns()}`;
  }
  if (ph === "vote") {
    const mine = myInput();
    if (mine) return `<div class="big-card" style="margin-top:14px"><div class="big-word">🗳️</div><p>صوّتّ لـ <b>${esc(nameOf(mine))}</b>. استنى الباقي (${Object.keys(inputsNowView()).length}/${parts.length})</p></div>${chatBox(s)}${hostBtn("اعرض النتيجة")}`;
    return `<h3 class="center" style="margin:14px 0 8px">مين المخادع في رأيك؟</h3>${chatBox(s)}` +
      parts.filter((u) => u !== S.uid).map((u) => `<button class="option-btn" style="width:100%;margin-bottom:10px" onclick="OL.vote('${esc(u)}')">${esc(nameOf(u))}</button>`).join("") + hostBtn("اعرض النتيجة");
  }
  return "";
}

function rosterChips(roster) {
  return `<div class="scoreboard" style="margin-top:12px">` + Object.keys(roster || {}).map((u) => { const x = roster[u]; return `<span class="chip${x.alive ? "" : " dead"}">${esc(x.name)} — ${esc(x.role)}</span>`; }).join("") + `</div>`;
}
function vMaf(s, ph) {
  const P = S.priv, parts = s.parts || [], me = (s.roster || {})[S.uid], alive = me ? me.alive : true;
  if (ph === "end") {
    const bad = s.bad || [];
    const rows = parts.map((u) => `<div class="rank-row${bad.includes(u) ? " first" : ""}"><span>${bad.includes(u) ? "😈 " : "😇 "}${esc(nameOf(u))} — ${esc((s.roster[u] || {}).role)}</span><span>${bad.includes(u) ? "مجرم" : "بريء"}</span></div>`).join("");
    return `<div class="big-card" style="margin-top:14px"><div class="big-word" style="color:${s.win ? "#22c55e" : "#ef4444"}">${s.win ? "🎉 كسب الأبرياء!" : "😈 كسب المجرمون!"}</div></div>${rows}${endButtons()}`;
  }
  if (ph === "reveal") {
    if (!P) return `<p class="muted center" style="margin-top:20px">جاري توزيع الأدوار...</p>`;
    const ready = !!myInput(), n = Object.keys(inputsNowView()).length;
    const story = `<div class="big-card" style="margin-top:14px"><h3 style="color:#facc15">🚨 ${esc(s.title)}</h3><p style="margin-top:8px">${esc(s.story)}</p><p class="muted" style="margin-top:8px">عدد المجرمين: ${s.count}</p></div>`;
    if (ready) return story + `<p class="muted center">✅ تمام. استنى الباقي (${n}/${parts.length})</p>${hostBtn("ابدأ الجولة حالاً")}`;
    const card = P.mafia
      ? `<div class="big-word" style="color:#ef4444">😈 أنت المجرم!</div><p>شخصيتك: <b>${esc(P.role)}</b></p><p style="margin-top:8px">${esc(P.text)}</p>` + (P.mates && P.mates.length ? `<p style="margin-top:8px;color:#facc15">شريكك: <b>${P.mates.map(esc).join("، ")}</b></p>` : "")
      : `<div class="big-word" style="color:#22c55e">😇 أنت بريء</div><p>شخصيتك: <b>${esc(P.role)}</b></p><p class="muted" style="margin-top:8px">ساعد الأبرياء يكشفوا المجرم، وانتبه لأي تناقض.</p>`;
    return story + `<div class="big-card">${card}</div><div class="center"><button class="primary-btn" onclick="OL.ready()">تمام، أخفِ الشاشة ✅</button></div>`;
  }
  if (ph === "round") {
    return rosterChips(s.roster) + `<div class="big-card"><h3 style="color:#38bdf8">🔎 الدليل رقم ${s.round}</h3><p style="margin-top:10px;font-size:1.1rem">${esc(s.clue)}</p>
      <p class="muted" style="margin-top:10px">كل واحد بيتكلم دقيقة بحرية: اتهم، دافع، اشرح، أو اسأل. المجرم بيكذب والبريء بيحاول يكشفه.</p></div>
      ${turnPanel(s)}<div class="center"><button class="ghost-btn" onclick="OL.peek()">👀 ${S.peek && P ? (P.mafia ? "😈 مجرم" : "😇 بريء") + " — " + esc(P.role) : "فكّرني بدوري"}</button></div>${hostTurnBtns()}`;
  }
  if (ph === "vote") {
    const mine = myInput();
    if (!alive) return rosterChips(s.roster) + `<p class="muted center">إنت خارج اللعبة. تابع التصويت... 👀</p>${chatBox(s)}${hostBtn("اعرض النتيجة")}`;
    if (mine) return rosterChips(s.roster) + `<div class="big-card"><p>🗳️ صوّتّ لـ <b>${esc(nameOf(mine))}</b>. استنى الباقي.</p></div>${chatBox(s)}${hostBtn("اعرض النتيجة")}`;
    return rosterChips(s.roster) + `<h3 class="center" style="margin:14px 0 8px">مين يخرج من اللعبة؟</h3>${chatBox(s)}` +
      parts.filter((u) => u !== S.uid && (s.roster[u] || {}).alive).map((u) => `<button class="option-btn" style="width:100%;margin-bottom:10px" onclick="OL.vote('${esc(u)}')">${esc(nameOf(u))} — ${esc(s.roster[u].role)}</button>`).join("") + hostBtn("اعرض النتيجة");
  }
  if (ph === "out") {
    return rosterChips(s.roster) + `<div class="big-card">` + (s.out
      ? `<div class="big-word" style="color:${s.wasMafia ? "#22c55e" : "#ef4444"}">${s.wasMafia ? "🎯 كان مجرم!" : "😢 كان بريء!"}</div><p>${esc(s.outName)} (${esc(s.outRole)}) خرج من اللعبة.${s.tied ? " (تعادل: اتختار عشوائياً)" : ""}</p>`
      : `<div class="big-word">🤷 ما حدش خرج</div><p>ما فيش أصوات.</p>`) + `</div>`;
  }
  return "";
}

function vCh(s, ph) {
  if (ph === "end") return `<h2 class="center" style="color:#38bdf8;margin:14px 0">🏁 انتهت الجولات!</h2>${rankList(s.scores, s.order)}${endButtons()}`;
  const head = `${scoreBoard(s.scores, s.order)}`;
  if (ph === "turnEnd") return head + `<div class="big-card"><div class="big-word" style="font-size:1.5rem">${esc(s.msg)}</div></div>`;
  const actorName = nameOf(s.actor), iAct = s.actor === S.uid;
  if (iAct) {
    if (S.picking) return head + `<h3 class="center" style="margin:14px 0 12px">مين اللي خمّن؟</h3>` +
      (s.order || []).filter((u) => u !== S.uid).map((u) => `<button class="option-btn" style="width:100%;margin-bottom:10px" onclick="OL.guessed('${esc(u)}')">${esc(nameOf(u))}</button>`).join("");
    return head + `<div class="big-card"><p>🎭 دورك (${s.t + 1} من ${s.turns}) — مثّل من غير كلام:</p><div class="big-word">${S.priv ? esc(S.priv.title) : "…"}</div>${timerHtml(s.endsAt)}</div>
      <div class="center"><button class="primary-btn" onclick="OL.pick()">✅ خمّنوه</button><button class="ghost-btn" onclick="OL.skip()">⏭ تخطي</button></div>${hostBtn("أنهِ الدور")}`;
  }
  return head + `<div class="big-card"><p>🎭 (${s.t + 1} من ${s.turns}) الممثل:</p><div class="big-word">${esc(actorName)}</div><p class="muted">خمّنوا الفيلم! لما حد يخمّن، الممثل هيختاره.</p>${timerHtml(s.endsAt)}</div>${hostBtn("أنهِ الدور")}`;
}


/* ------------------------- الصوت (WebRTC عبر Firebase) ------------------------- */
const ICE = { iceServers: [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
  { urls: ["stun:stun.relay.metered.ca:80"] },
  { urls: ["turn:global.relay.metered.ca:80", "turn:global.relay.metered.ca:80?transport=tcp", "turn:global.relay.metered.ca:443", "turns:global.relay.metered.ca:443?transport=tcp"], username: "93d50da04abab870aa05fb9c", credential: "DtpGc9vE+O6iUg5B" }
] };
const V = { on: false, stream: null, at: 0, pcs: {}, pend: {}, audios: {}, ana: {}, tries: {}, seen: {}, muted: false, ctx: null, off: null, q: Promise.resolve(), vu: null };
const vInbox = () => S.api.ref(S.db, "rooms/" + S.code + "/voice/" + S.uid);
const vSend = (to, type, data) => S.api.push(S.api.ref(S.db, "rooms/" + S.code + "/voice/" + to), { from: S.uid, type, data: JSON.stringify(data) }).catch(() => {});

async function voiceJoin() {
  if (V.on || !S.code) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) return toast("المتصفح ده مش بيدعم الصوت.");
  try { V.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }); }
  catch (e) { return toast("لازم تسمح للميكروفون عشان الصوت يشتغل 🎤"); }
  if (!S.code) { V.stream.getTracks().forEach((t) => t.stop()); return; }
  V.on = true; V.muted = false; V.tries = {}; V.seen = {}; V.at = Date.now();
  try { V.ctx = new (window.AudioContext || window.webkitAudioContext)(); V.ctx.resume && V.ctx.resume(); } catch (e) { V.ctx = null; }
  addAna(S.uid, V.stream);
  try { await S.api.remove(vInbox()); } catch (e) {}
  V.off = S.api.onChildAdded(vInbox(), (snap) => {
    const m = snap.val(); if (!m) return;
    try { S.api.remove(snap.ref || S.api.ref(S.db, "rooms/" + S.code + "/voice/" + S.uid + "/" + snap.key)); } catch (e) {}
    V.q = V.q.then(() => onSignal(m.from, m.type, m.data)).catch(() => {});
  });
  const pr = R("public/players/" + S.uid + "/voice");
  try { S.api.onDisconnect(pr).remove(); } catch (e) {}
  await S.api.set(pr, V.at).catch(() => {});
  clearInterval(V.vu); V.vu = setInterval(voiceMeter, 180);
  voiceSync();
}
function voiceLeave(silent) {
  const was = V.on; V.on = false;
  Object.keys(V.pcs).forEach((u) => closePeer(u));
  Object.keys(V.audios).forEach((u) => dropAudio(u));
  Object.keys(V.ana).forEach((u) => delete V.ana[u]);
  if (V.stream) V.stream.getTracks().forEach((t) => t.stop());
  V.stream = null; V.pend = {}; V.tries = {}; V.seen = {};
  if (V.off) { try { V.off(); } catch (e) {} V.off = null; }
  if (V.ctx) { try { V.ctx.close(); } catch (e) {} V.ctx = null; }
  clearInterval(V.vu); V.vu = null;
  if (was && S.code && !silent) { S.api.remove(R("public/players/" + S.uid + "/voice")).catch(() => {}); S.api.remove(vInbox()).catch(() => {}); }
  else if (was && S.code && silent && S.room) { S.api.remove(R("public/players/" + S.uid + "/voice")).catch(() => {}); }
  voiceBar();
}
function voiceMute() {
  if (!V.on || !V.stream) return;
  V.muted = !V.muted; V.stream.getAudioTracks().forEach((t) => { t.enabled = !V.muted; });
  voiceBar();
}
function addAna(u, stream) {
  if (!V.ctx) return;
  try { const an = V.ctx.createAnalyser(); an.fftSize = 256; V.ctx.createMediaStreamSource(stream).connect(an); V.ana[u] = an; } catch (e) {}
}
function voiceMeter() {
  const box = g("ol-voice"); if (!box) return;
  Object.keys(V.ana).forEach((u) => {
    const an = V.ana[u], d = new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(d);
    let m = 0; for (let i = 0; i < d.length; i++) m += d[i]; m /= d.length;
    const el = box.querySelector('[data-vu="' + u + '"]');
    if (el) el.classList.toggle("speak", m > 14 && !(u === S.uid && V.muted));
  });
}
function mkPC(peer) {
  const pc = new RTCPeerConnection(ICE); V.pcs[peer] = pc; V.pend[peer] = V.pend[peer] || [];
  V.stream.getTracks().forEach((t) => pc.addTrack(t, V.stream));
  pc.onicecandidate = (e) => { if (e.candidate) vSend(peer, "ice", e.candidate.toJSON()); };
  pc.ontrack = (e) => attachAudio(peer, e.streams[0] || new MediaStream([e.track]));
  pc.onconnectionstatechange = () => {
    const st0 = pc.connectionState;
    if (st0 === "connected") V.tries[peer] = 0;
    if (st0 === "failed" || st0 === "closed") { if (V.pcs[peer] === pc) { closePeer(peer); if ((V.tries[peer] || 0) >= 3) toast("تعذّر الصوت مع " + nameOf(peer) + " (الشبكة بتمنع الاتصال)."); else setTimeout(voiceSync, 1500); } }
    else if (st0 === "disconnected") setTimeout(() => { if (V.pcs[peer] === pc && pc.connectionState === "disconnected") { closePeer(peer); voiceSync(); } }, 5000);
  };
  return pc;
}
function attachAudio(u, stream) {
  dropAudio(u);
  const a = document.createElement("audio"); a.autoplay = true; a.playsInline = true; a.srcObject = stream; a.style.display = "none";
  document.body.appendChild(a); V.audios[u] = a; a.play().catch(() => {});
  addAna(u, stream);
}
function dropAudio(u) { const a = V.audios[u]; if (a) { try { a.srcObject = null; a.remove(); } catch (e) {} } delete V.audios[u]; delete V.ana[u]; }
function closePeer(u) { const pc = V.pcs[u]; delete V.pcs[u]; delete V.pend[u]; dropAudio(u); if (pc) { pc.onconnectionstatechange = null; try { pc.close(); } catch (e) {} } }
async function flushIce(u) { const pc = V.pcs[u], l = V.pend[u] || []; V.pend[u] = []; for (const c of l) { try { await pc.addIceCandidate(c); } catch (e) {} } }
async function onSignal(from, type, raw) {
  if (!V.on || !V.stream) return;
  let data; try { data = JSON.parse(raw); } catch (e) { return; }
  try {
    if (type === "offer") {
      const keep = V.pend[from]; closePeer(from); V.pend[from] = keep || [];
      const pc = mkPC(from); await pc.setRemoteDescription(data); await flushIce(from);
      const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); vSend(from, "answer", { type: ans.type, sdp: ans.sdp });
    } else if (type === "answer") {
      const pc = V.pcs[from]; if (pc && pc.signalingState === "have-local-offer") { await pc.setRemoteDescription(data); await flushIce(from); }
    } else if (type === "ice") {
      const pc = V.pcs[from];
      if (pc && pc.remoteDescription) { try { await pc.addIceCandidate(data); } catch (e) {} } else (V.pend[from] = V.pend[from] || []).push(data);
    }
  } catch (e) { console.warn("voice signal", e); }
}
async function callPeer(u) {
  V.tries[u] = (V.tries[u] || 0) + 1;
  try {
    const pc = mkPC(u), off = await pc.createOffer(); await pc.setLocalDescription(off);
    vSend(u, "offer", { type: off.type, sdp: off.sdp });
  } catch (e) { closePeer(u); }
}
function voiceSync() {
  if (V.on && S.room && S.code) {
    const pl = S.room.players || {};
    Object.keys(pl).forEach((u) => {
      if (u === S.uid) return;
      const p = pl[u], inV = !!p.voice && p.online !== false;
      if (V.seen[u] !== undefined && V.seen[u] !== (p.voice || 0) && V.pcs[u]) closePeer(u);   // رجع تاني بجلسة جديدة
      V.seen[u] = p.voice || 0;
      if (inV && !V.pcs[u]) {
        const initiator = V.at > p.voice || (V.at === p.voice && S.uid > u);
        if (initiator && (V.tries[u] || 0) < 3) callPeer(u);
      }
      if (!inV && V.pcs[u]) closePeer(u);
    });
    Object.keys(V.pcs).forEach((u) => { if (!pl[u]) closePeer(u); });
    if (!pl[S.uid]) voiceLeave(true);
  }
  voiceBar();
}
function voiceBar() {
  let el = g("ol-voice");
  if (!el) { el = document.createElement("div"); el.id = "ol-voice"; document.body.appendChild(el); }
  if (!S.code || !S.room) { el.style.display = "none"; return; }
  el.style.display = "flex";
  const inV = plist().filter((p) => p.voice && p.online);
  const chips = inV.map((p) => `<span class="vchip" data-vu="${esc(p.uid)}">${p.uid === S.uid && V.muted ? "🔇" : "🎙️"} ${esc(p.name)}</span>`).join("");
  const camBtn = `<button class="vbtn cam" id="ol-vcam" onclick="window.MEMA_VCALL&&MEMA_VCALL.toggle()">📹 فيديو</button>`;
  el.innerHTML = camBtn + (V.on
    ? `<button class="vbtn${V.muted ? " off" : ""}" onclick="OL.vMute()">${V.muted ? "🔇 مكتوم" : "🎤 شغال"}</button><div class="vlist">${chips}</div><button class="vbtn leave" onclick="OL.vLeave()">✖</button>`
    : `<button class="vbtn join" onclick="OL.vJoin()">🎤 ادخل الصوت</button>${inV.length ? `<div class="vlist">${chips}</div>` : ""}`);
  if (window.MEMA_VCALL && MEMA_VCALL.paint) MEMA_VCALL.paint();
}

/* ============================== سكرو ============================== */
const SC_TURN = 60000, SC_PEEK = 30000, SC_END = 30000, SC_ROUNDS = 4;
const SC_NAMES = { swap: "بدّل", look: "شوف قبل ما تبدّل", basra: "بصرة", kaab: "كعب داير" };
const scVal = (c) => !c ? 0 : c.t === "n" ? c.v : c.t === "g" ? 0 : c.t === "m1" ? -1 : c.t === "r" ? 25 : c.t === "p20" ? 20 : 10;
const scName = (c) => !c ? "" : c.t === "n" ? "رقم " + c.v : c.t === "g" ? "سكرو أخضر" : c.t === "m1" ? "سالب 1" : c.t === "r" ? "سكرو أحمر" : c.t === "p20" ? "+20" : SC_NAMES[c.t];
function scKind(c) {
  if (c.t === "n") return c.v === 7 || c.v === 8 ? "peekOwn" : c.v === 9 || c.v === 10 ? "peekOther" : null;
  return { swap: "swap", look: "look", basra: "basra", kaab: "kaab" }[c.t] || null;
}
function scDeck() {
  const d = [];
  for (let v = 1; v <= 10; v++) for (let k = 0; k < 4; k++) d.push({ t: "n", v });
  [["swap", 4], ["look", 4], ["basra", 4], ["kaab", 2], ["g", 2], ["m1", 1], ["r", 4], ["p20", 4]].forEach(([t, n]) => { for (let k = 0; k < n; k++) d.push({ t }); });
  return shuf(d);
}
function scPub(extra) {
  const occ = {}; H.order.forEach((u) => { occ[u] = H.hands[u].map((c) => (c ? 1 : 0)); });
  return Object.assign({ round: H.round, rounds: SC_ROUNDS, blind: H.round >= 3, top: H.disc.length ? H.disc[H.disc.length - 1] : 0,
    deckN: H.deck.length, occ, scores: H.totals, caller: H.caller || "", order: H.order, msg: H.msg || "" }, extra);
}
function scPriv(map) { const o = {}; H.order.forEach((u) => { o[u] = (map && map[u]) || null; }); return o; }
async function scPushTurn(extra, priv) {
  await pushState(scPub(Object.assign({ phase: "turn", stage: H.stage, kind: H.kind || "", turn: H.cur, endsAt: now() + SC_TURN }, extra)), scPriv(priv));
  after(SC_TURN, scTimeout);
}
function scDrawCard() {
  if (!H.deck.length && H.disc.length > 1) { const top = H.disc.pop(); H.deck = shuf(H.disc); H.disc = [top]; }
  return H.deck.pop() || null;
}

async function scStart() {
  const ps = active();
  H = base("scro", { order: ps.map((p) => p.uid), round: 0, totals: {}, lastN: {}, hands: {}, deck: [], disc: [], caller: null, msg: "" });
  H.order.forEach((u) => { H.totals[u] = 0; });
  await scRound();
}
async function scRound() {
  H.round++; H.deck = scDeck(); H.hands = {}; H.caller = null; H.msg = ""; H.stage = null; H.drawn = null; H.kind = null;
  H.order.forEach((u) => { H.hands[u] = [H.deck.pop(), H.deck.pop(), H.deck.pop(), H.deck.pop()]; });
  H.disc = [H.deck.pop()];
  H.ti = (H.round - 1) % H.order.length;
  if (H.round >= 3) return scTurnStart();                    // الجولتين الأخيرتين عمياني
  await pushState(scPub({ phase: "peek", endsAt: now() + SC_PEEK }), scPriv());
  after(SC_PEEK, scPeekShow);
}
async function scPeekShow() {
  clearTimeout(H.timer);
  const inp = inputsNow(), priv = {};
  H.order.forEach((u) => {
    let sel = inp[u] && inp[u].val;
    if (!Array.isArray(sel) || sel.length !== 2 || sel[0] === sel[1] || !sel.every((i) => Number.isInteger(i) && i >= 0 && i < 4)) sel = shuf([0, 1, 2, 3]).slice(0, 2);
    priv[u] = { peek: sel.map((i) => ({ w: u, s: i, c: H.hands[u][i] })) };
  });
  await pushState(scPub({ phase: "peekshow", endsAt: now() + 20000 }), scPriv(priv));
  after(20000, scBegin);
}
async function scBegin() { clearTimeout(H.timer); await scTurnStart(); }
async function scTurnStart() {
  clearTimeout(H.timer);
  H.cur = H.order[H.ti]; H.stage = "start"; H.drawn = null; H.kind = null;
  const on = ((room().players || {})[H.cur] || {}).online !== false;
  await pushState(scPub({ phase: "turn", stage: "start", kind: "", turn: H.cur, endsAt: now() + SC_TURN }), scPriv());
  after(on ? SC_TURN : 1500, scTimeout);
}
async function scEndTurn() {
  clearTimeout(H.timer);
  H.ti = (H.ti + 1) % H.order.length;
  if (H.caller && H.order[H.ti] === H.caller) return scRoundEnd();
  return scTurnStart();
}
async function scTimeout() {
  if (!H || H.type !== "scro" || st().phase !== "turn") return;
  if (H.drawn) { H.disc.push(H.drawn.c); H.drawn = null; }
  H.msg = nameOf(H.cur) + " اتأخر، اتخطى دوره ⏰";
  await scEndTurn();
}
async function scRoundEnd() {
  clearTimeout(H.timer);
  const tot = {}, add = {};
  H.order.forEach((u) => { tot[u] = H.hands[u].reduce((s, c) => s + scVal(c), 0); });
  const mn = Math.min(...H.order.map((u) => tot[u])), low = H.order.filter((u) => tot[u] === mn);
  H.order.forEach((u) => { add[u] = low.includes(u) ? 0 : tot[u]; });
  const pen = !!(H.caller && !low.includes(H.caller));
  if (pen) add[H.caller] = tot[H.caller] * 2;
  H.order.forEach((u) => { H.totals[u] += add[u]; });
  const reveal = {}; H.order.forEach((u) => { reveal[u] = H.hands[u].map((c) => c || 0); });
  await pushState({ phase: "roundEnd", round: H.round, rounds: SC_ROUNDS, order: H.order, scores: H.totals, reveal, tot, add, low, caller: H.caller || "", pen, endsAt: now() + SC_END }, scPriv());
  after(SC_END, scNextRound);
}
async function scNextRound() {
  clearTimeout(H.timer);
  if (H.round >= SC_ROUNDS) return pushState({ phase: "end", scores: H.totals, order: H.order }, scPriv());
  await scRound();
}
function scTick() {
  const ph = st().phase, inp = inputsNow(), parts = active().filter((p) => H.order.includes(p.uid));
  if (ph === "peek") { if (parts.length && parts.every((p) => Array.isArray((inp[p.uid] || {}).val))) scPeekShow(); }
  else if (ph === "peekshow") { if (parts.length && parts.every((p) => inp[p.uid])) scBegin(); }
  else if (ph === "roundEnd") { if (parts.length && parts.every((p) => inp[p.uid])) scNextRound(); }
  else if (ph === "turn") {
    const i = inp[H.cur], v = i && i.val;
    if (v && typeof v === "object" && v.n > (H.lastN[H.cur] || 0)) { H.lastN[H.cur] = v.n; scAct(v); }
  }
}
async function scAct(v) {
  const u = H.cur, hand = H.hands[u], g_ = H.stage, nm = nameOf(u);
  const ok = (w, i) => !!(H.hands[w] && Number.isInteger(i) && i >= 0 && i < 4 && H.hands[w][i]);
  const other = (w) => w !== u && H.order.includes(w);
  const cnt = (w) => H.hands[w].filter(Boolean).length;
  const swapC = (w1, i1, w2, i2) => { const t = H.hands[w1][i1]; H.hands[w1][i1] = H.hands[w2][i2]; H.hands[w2][i2] = t; };
  if (g_ === "start") {
    if (v.a === "scro" && !H.caller) { H.caller = u; H.msg = nm + " قال سكرو! 🔥 الدور هيلف على الكل مرة"; return scEndTurn(); }
    if (v.a === "deck") {
      const c = scDrawCard(); if (!c) return scRoundEnd();
      H.drawn = { c, from: "deck" }; H.stage = "drawn"; H.msg = nm + " سحب من الدسته";
      return scPushTurn({ from: "deck" }, { [u]: { drawn: c } });
    }
    if (v.a === "disc" && H.disc.length) {
      const c = H.disc.pop(); H.drawn = { c, from: "disc" }; H.stage = "drawn"; H.msg = nm + " أخد " + scName(c) + " من الأرض";
      return scPushTurn({ from: "disc" }, { [u]: { drawn: c } });
    }
    return;
  }
  if (g_ === "drawn") {
    const d = H.drawn;
    if (v.a === "swap" && ok(u, v.i)) {
      const old = hand[v.i]; hand[v.i] = d.c; H.disc.push(old); H.drawn = null;
      H.msg = nm + " بدّل كارت ورمى " + scName(old); return scEndTurn();
    }
    if (v.a === "discard" && d.from === "deck") {
      H.disc.push(d.c); H.drawn = null; const k = scKind(d.c);
      if (!k) { H.msg = nm + " رمى " + scName(d.c); return scEndTurn(); }
      H.kind = k; H.stage = "act"; H.msg = nm + " رمى " + scName(d.c) + " وهيستخدم قدرته ✨";
      return scPushTurn({}, {});
    }
    return;
  }
  if (g_ === "act") {
    const k = H.kind;
    const ack = (items, msg) => { H.stage = "ack"; H.msg = msg; return scPushTurn({}, { [u]: { peek: items } }); };
    if (k === "peekOwn" && v.a === "peek" && ok(u, v.i)) return ack([{ w: u, s: v.i, c: hand[v.i] }], nm + " بص على كارت من كروته 👁");
    if (k === "peekOther" && v.a === "peek" && other(v.u) && ok(v.u, v.i)) return ack([{ w: v.u, s: v.i, c: H.hands[v.u][v.i] }], nm + " بص على كارت " + nameOf(v.u) + " 👁");
    if (k === "basra" && v.a === "drop" && ok(u, v.i)) { const c = hand[v.i]; hand[v.i] = null; H.disc.push(c); H.msg = nm + " رمى كارت من عنده (" + scName(c) + ") 🗑"; return scEndTurn(); }
    if (k === "swap" && v.a === "do" && ok(u, v.i) && other(v.u) && ok(v.u, v.j)) { swapC(u, v.i, v.u, v.j); H.msg = nm + " بدّل كارت مع " + nameOf(v.u) + " ⇄"; return scEndTurn(); }
    if (k === "look" && v.a === "look" && other(v.u) && ok(v.u, v.j)) {
      H.seen = { u: v.u, j: v.j }; H.stage = "look2"; H.msg = nm + " بيبص على كارت " + nameOf(v.u) + " 👁";
      return scPushTurn({ seenWho: v.u, seenSlot: v.j }, { [u]: { peek: [{ w: v.u, s: v.j, c: H.hands[v.u][v.j] }] } });
    }
    if (k === "kaab") {
      if (v.a === "own" && Array.isArray(v.p)) {
        const need = Math.min(2, cnt(u));
        if (v.p.length === need && new Set(v.p).size === need && v.p.every((i) => ok(u, i))) return ack(v.p.map((i) => ({ w: u, s: i, c: hand[i] })), nm + " بص على كروته 🔄");
      }
      if (v.a === "others" && v.picks && typeof v.picks === "object") {
        const items = []; let good = true;
        H.order.filter(other).forEach((w) => { if (!cnt(w)) return; const i = v.picks[w]; if (!ok(w, i)) good = false; else items.push({ w, s: i, c: H.hands[w][i] }); });
        if (good && items.length) return ack(items, nm + " بص على كارت من كل لاعب 🔄");
      }
    }
    return;
  }
  if (g_ === "look2") {
    const T = H.seen;
    if (!ok(T.u, T.j)) return scEndTurn();
    if (v.a === "take" && ok(u, v.i)) { swapC(u, v.i, T.u, T.j); H.msg = nm + " خد الكارت وادّى " + nameOf(T.u) + " كارت من عنده ⇄"; return scEndTurn(); }
    if (v.a === "give" && other(v.x) && v.x !== T.u && ok(v.x, v.k)) { swapC(T.u, T.j, v.x, v.k); H.msg = nm + " لبّس " + nameOf(T.u) + " و" + nameOf(v.x) + " في بعض ⇄"; return scEndTurn(); }
    if (v.a === "skip" && H.order.length < 3) { H.msg = nm + " ما بدّلش"; return scEndTurn(); }
    return;
  }
  if (g_ === "ack" && v.a === "ok") return scEndTurn();
}

/* ---- واجهة سكرو ---- */
const newU = () => ({ sel: [], p: [], o: {}, i: null, mode: null });
let U = newU(), scN = 0;
const scSend = (v) => sendInput(Object.assign({ n: ++scN }, v));
function scFace(c, cls) {
  if (!c) return '<div class="sc-card empty ' + (cls || "") + '"></div>';
  const t = c.t, val = scVal(c); let big = "", sm = "";
  if (t === "n") { big = c.v; sm = c.v >= 9 ? "👁 غيرك" : c.v >= 7 ? "👁 ورقتك" : ""; }
  else if (t === "g") { big = "0"; sm = "سكرو"; }
  else if (t === "m1") { big = "-1"; sm = "سالب واحد"; }
  else if (t === "r") { big = "25"; sm = "سكرو"; }
  else if (t === "p20") { big = "+20"; sm = "زيادة"; }
  else { big = { swap: "⇄", look: "👁", basra: "🗑", kaab: "🔄" }[t]; sm = SC_NAMES[t]; }
  return `<div class="sc-card face t-${t}${t === "n" ? " n" + c.v : ""} ${cls || ""}"><i class="c1">${val}</i><b>${big}</b><span>${sm}</span><i class="c2">${val}</i></div>`;
}
const scBack = (cls) => `<div class="sc-card back ${cls || ""}"><em>🎮</em></div>`;
function scPickable(w, i, s) {
  const me = S.uid, mine = w === me;
  if (s.phase === "peek") return mine && !myInput();
  if (s.phase !== "turn" || s.turn !== me) return false;
  const g_ = s.stage, k = s.kind;
  if (g_ === "drawn") return mine && U.mode === "swap";
  if (g_ === "act") {
    if (k === "peekOwn" || k === "basra") return mine;
    if (k === "peekOther" || k === "look") return !mine;
    if (k === "swap") return U.i == null ? mine : !mine;
    if (k === "kaab") return U.mode === "own" ? mine : U.mode === "others" ? !mine : false;
  }
  if (g_ === "look2") return U.mode === "take" ? mine : U.mode === "give" ? (!mine && w !== s.seenWho) : false;
  return false;
}
function scSelected(w, i, s) {
  if (s.phase === "peek") return w === S.uid && U.sel.includes(i);
  if (s.stage === "act" && s.kind === "swap") return w === S.uid && U.i === i;
  if (s.stage === "act" && s.kind === "kaab") return (U.mode === "own" && w === S.uid && U.p.includes(i)) || (U.mode === "others" && U.o[w] === i);
  return false;
}
function scHand(w, s) {
  const occ = (s.occ || {})[w] || [1, 1, 1, 1], peek = (S.priv && S.priv.peek) || [];
  return `<div class="sc-hand">` + [0, 1, 2, 3].map((i) => {
    if (!occ[i]) return `<div class="sc-slot gone"><div class="sc-card empty"></div></div>`;
    const pk = peek.find((x) => x.w === w && x.s === i), pick = scPickable(w, i, s), sel = scSelected(w, i, s);
    return `<button class="sc-slot${pick ? " pick" : ""}${sel ? " sel" : ""}" ${pick ? `onclick="OL.slot('${esc(w)}',${i})"` : "disabled"}><span class="sc-no">${i + 1}</span>${pk ? scFace(pk.c, "flip") : scBack()}</button>`;
  }).join("") + `</div>`;
}
function scoreAsc(scores, order) {
  scores = scores || {};
  return `<div class="scoreboard">` + (order || []).slice().sort((a, b) => (scores[a] || 0) - (scores[b] || 0))
    .map((u) => `<span class="chip${u === S.uid ? " turn" : ""}">${esc(nameOf(u))}: ${scores[u] || 0}</span>`).join("") + `</div>`;
}
function scControls(s, ph) {
  const me = S.uid, P = S.priv || {}, mine = s.turn === me;
  if (ph === "peek") {
    if (myInput()) return `<p class="muted center">✅ تمام، استنى الباقي...</p>`;
    return `<p class="center">اختار كارتين من كروتك تبص عليهم (${U.sel.length}/2)</p>` + (U.sel.length === 2 ? `<div class="center"><button class="primary-btn" onclick="OL.scPeekOk()">تأكيد ✅</button></div>` : "");
  }
  if (ph === "peekshow") {
    if (myInput()) return `<p class="muted center">✅ استنى الباقي...</p>`;
    return `<p class="center">دول الكروت اللي اخترتها — احفظ مكانها! 🧠</p><div class="center"><button class="primary-btn" onclick="OL.ready()">حفظت، أخفِ الكروت ✅</button></div>`;
  }
  if (!mine) return `<p class="muted center">⏳ دور <b>${esc(nameOf(s.turn))}</b>...</p>${hostBtn("⏭ تخطي دوره")}`;
  const g_ = s.stage, k = s.kind;
  const btn = (t, f, c) => `<button class="${c || "primary-btn"}" onclick="${f}">${t}</button>`;
  if (g_ === "start") return `<p class="center">دورك! اختار:</p><div class="center">${btn("📥 اسحب من الدسته", "OL.scDo('deck')")}${s.top ? btn("🔄 خد من الأرض", "OL.scDo('disc')", "ghost-btn") : ""}${s.caller ? "" : btn("🗣️ سكرو!", "OL.scDo('scro')", "danger-btn")}</div>`;
  if (g_ === "drawn") {
    return `<p class="center">الكارت اللي سحبته:</p><div class="center">${scFace(P.drawn, "flip big")}</div>` +
      (U.mode === "swap" ? `<p class="center">اضغط على الكارت اللي عايز تبدّله من كروتك 👆</p>` :
        `<div class="center">${btn("🔁 بدّله بكارت من عندي", "OL.scMode('swap')")}${s.from === "deck" ? btn("🗑 ارميه (وهتستخدم قدرته لو ليه قدرة)", "OL.scDo('discard')", "ghost-btn") : ""}</div>`);
  }
  if (g_ === "ack") return `<p class="center">اللي شفته:</p><div class="center sc-peekrow">${(P.peek || []).map((x) => `<div class="sc-peeked">${scFace(x.c, "flip")}<small>${x.w === me ? "كارتك " + (x.s + 1) : esc(nameOf(x.w)) + " — كارت " + (x.s + 1)}</small></div>`).join("")}</div><div class="center">${btn("تمام ✅", "OL.scDo('ok')")}</div>`;
  if (g_ === "look2") {
    const seen = (P.peek || [])[0];
    const third = (s.order || []).filter((u) => u !== me && u !== s.seenWho).length > 0;
    return `<p class="center">الكارت اللي شفته عند ${esc(nameOf(s.seenWho))}:</p><div class="center">${scFace(seen && seen.c, "flip big")}</div>` +
      (U.mode === "take" ? `<p class="center">اضغط على كارت من عندك تدّيه له 👆</p>` : U.mode === "give" ? `<p class="center">اضغط على كارت عند لاعب تاني تبدّله بالكارت ده 👆</p>` :
        `<div class="center">${btn("✅ عجبني! أخده", "OL.scMode('take')")}${third ? btn("❌ مش عاجبني — بدّله مع لاعب تاني", "OL.scMode('give')", "ghost-btn") : btn("❌ مش عاجبني — سيبه", "OL.scDo('skip')", "ghost-btn")}</div>`);
  }
  if (g_ === "act") {
    const T = { peekOwn: "👁 اضغط على كارت من كروتك تبص عليه", peekOther: "👁 اضغط على كارت عند لاعب تاني تبص عليه", basra: "🗑 بصرة! اضغط على كارت من كروتك ترميه", look: "👁 اضغط على كارت عند لاعب تاني تبص عليه قبل ما تبدّل" };
    if (T[k]) return `<p class="center">${T[k]}</p>`;
    if (k === "swap") return `<p class="center">${U.i == null ? "⇄ بدّل: اضغط على كارت من كروتك الأول" : "دلوقتي اضغط على كارت عند لاعب تاني تبدّله"}</p>`;
    if (k === "kaab") {
      if (!U.mode) return `<p class="center">🔄 كعب داير! اختار:</p><div class="center">${btn("أشوف كارتين من عندي", "OL.scMode('own')")}${btn("أشوف كارت عند كل لاعب", "OL.scMode('others')", "ghost-btn")}</div>`;
      if (U.mode === "own") return `<p class="center">اختار كارتين من كروتك (${U.p.length}/${Math.min(2, ((s.occ || {})[me] || []).filter(Boolean).length)})</p>`;
      const need = (s.order || []).filter((w) => w !== me && ((s.occ || {})[w] || []).some(Boolean));
      const done = need.every((w) => U.o[w] != null);
      return `<p class="center">اختار كارت واحد عند كل لاعب (${need.filter((w) => U.o[w] != null).length}/${need.length})</p>` + (done ? `<div class="center">${btn("تأكيد ✅", "OL.scOthers()")}</div>` : "");
    }
  }
  return "";
}
function vScro(s, ph) {
  const me = S.uid, order = s.order || plist().map((p) => p.uid);
  if (ph === "end") {
    const sc = s.scores || {}, mn = Math.min(...order.map((u) => sc[u] || 0));
    const rows = order.slice().sort((a, b) => (sc[a] || 0) - (sc[b] || 0)).map((u, i) => `<div class="rank-row${(sc[u] || 0) === mn ? " first" : ""}"><span>${(sc[u] || 0) === mn ? "🏆 " : i + 1 + ". "}${esc(nameOf(u))}${u === me ? " (أنت)" : ""}</span><span>${sc[u] || 0}</span></div>`).join("");
    return `<h2 class="center" style="color:#38bdf8;margin:14px 0">🏁 انتهت الجولات الأربعة!</h2><p class="muted center">الفايز هو صاحب أقل نقاط</p>${rows}${endButtons()}`;
  }
  if (ph === "roundEnd") {
    const rows = order.map((u) => {
      const low = (s.low || []).includes(u);
      return `<div class="sc-rrow${low ? " first" : ""}"><div class="sc-name">${esc(nameOf(u))}${u === me ? " (أنت)" : ""}${s.caller === u ? " 🔥" : ""}</div>
        <div class="sc-mini">${(s.reveal[u] || []).map((c) => c ? scFace(c, "mini") : '<div class="sc-card empty mini"></div>').join("")}</div>
        <div class="sc-pts">المجموع ${s.tot[u]} ← <b>+${s.add[u]}</b>${s.pen && s.caller === u ? " (عقاب ×2 😬)" : ""}${low ? " ⭐ الأقل = 0" : ""}<br>الإجمالي: ${s.scores[u]}</div></div>`;
    }).join("");
    return `<h3 class="center" style="margin:14px 0">📊 نتيجة الجولة ${s.round} من ${SC_ROUNDS}</h3>${rows}
      <div class="center" style="margin-top:12px">${myInput() ? `<p class="muted">✅ استنى الباقي...</p>` : `<button class="primary-btn" onclick="OL.ready()">${s.round >= SC_ROUNDS ? "عرض النتيجة النهائية 🏁" : "الجولة اللي بعدها ➡️"}</button>`}${hostBtn("⏭ كمّل")}</div>`;
  }
  const others = order.filter((u) => u !== me);
  const turnLine = (ph === "turn" || ph === "peek" || ph === "peekshow") ? timerHtml(s.endsAt) : "";
  return `<div class="sc-top"><span class="chip">الجولة ${s.round} / ${SC_ROUNDS}${s.blind ? " 🙈 عمياني" : ""}</span>${scoreAsc(s.scores, order)}</div>
    <div class="sc-opps">${others.map((w) => `<div class="sc-opp${s.turn === w && ph === "turn" ? " turn" : ""}"><div class="sc-name">${esc(nameOf(w))}${s.caller === w ? " 🔥" : ""}${s.turn === w && ph === "turn" ? " ⏳" : ""}</div>${scHand(w, s)}</div>`).join("")}</div>
    <div class="sc-table"><div class="sc-pile"><div class="sc-stack">${scBack()}</div><small>الدسته (${s.deckN})</small></div><div class="sc-pile">${s.top ? scFace(s.top) : '<div class="sc-card empty"></div>'}<small>الأرض</small></div></div>
    <div class="sc-msg">${esc(s.msg || (ph === "peek" ? "بص على كارتين من كروتك" : ""))}${s.caller ? ` <b style="color:#ef4444">🔥 ${esc(nameOf(s.caller))} قال سكرو!</b>` : ""}</div>${turnLine}
    <div class="sc-me${s.turn === me && ph === "turn" ? " turn" : ""}"><div class="sc-name">إنت (${esc(nameOf(me))})</div>${scHand(me, s)}</div>
    <div class="sc-ctl">${scControls(s, ph)}</div>`;
}
function scSlot(w, i) {
  const s = st(), me = S.uid, mine = w === me;
  if (s.phase === "peek") { if (!mine || myInput()) return; const k = U.sel.indexOf(i); if (k >= 0) U.sel.splice(k, 1); else if (U.sel.length < 2) U.sel.push(i); return renderRoom(); }
  if (s.phase !== "turn" || s.turn !== me) return;
  const g_ = s.stage, k = s.kind;
  if (g_ === "drawn") { if (mine && U.mode === "swap") scSend({ a: "swap", i }); return; }
  if (g_ === "act") {
    if (k === "peekOwn" && mine) return scSend({ a: "peek", i });
    if (k === "peekOther" && !mine) return scSend({ a: "peek", u: w, i });
    if (k === "basra" && mine) return scSend({ a: "drop", i });
    if (k === "swap") { if (mine) { U.i = i; return renderRoom(); } if (U.i != null) return scSend({ a: "do", i: U.i, u: w, j: i }); }
    if (k === "look" && !mine) return scSend({ a: "look", u: w, j: i });
    if (k === "kaab") {
      if (U.mode === "own" && mine) {
        const need = Math.min(2, ((s.occ || {})[me] || []).filter(Boolean).length);
        if (!U.p.includes(i)) U.p.push(i);
        if (U.p.length >= need) return scSend({ a: "own", p: U.p });
        return renderRoom();
      }
      if (U.mode === "others" && !mine) { U.o[w] = i; return renderRoom(); }
    }
  }
  if (g_ === "look2") {
    if (U.mode === "take" && mine) return scSend({ a: "take", i });
    if (U.mode === "give" && !mine && w !== s.seenWho) return scSend({ a: "give", x: w, k: i });
  }
}

/* ============ أوراق الكوتشينه: الشايب + بصرة (أونلاين أو مع بوتات) ============ */
const PC_SUIT = ["♠", "♥", "♦", "♣"];
const PC_RANK = (r) => ({ 1: "A", 11: "J", 12: "Q", 13: "K" }[r] || String(r));
const pcDeck = (joker) => { const d = []; for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) d.push({ r, s }); if (joker) d.push({ j: 1 }); return shuf(d); };
const pcRed = (c) => c.s === 1 || c.s === 2;
function pcFace(c, cls) {
  if (!c) return "";
  if (c.j) return `<div class="pc joker ${cls || ""}"><i class="c1">🃏</i><b>🃏</b><span>الشايب</span></div>`;
  return `<div class="pc ${pcRed(c) ? "red" : "blk"} ${cls || ""}"><i class="c1">${PC_RANK(c.r)}<br>${PC_SUIT[c.s]}</i><b>${PC_SUIT[c.s]}</b><i class="c2">${PC_RANK(c.r)}<br>${PC_SUIT[c.s]}</i></div>`;
}
const pcBack = (cls) => `<div class="pc back ${cls || ""}"><em>🎮</em></div>`;
const pcSort = (h) => (h || []).slice().sort((a, b) => (a.j ? 99 : a.r) - (b.j ? 99 : b.r) || (a.s || 0) - (b.s || 0));
const isBot = (u) => !!(S.room && S.room.players && S.room.players[u] && S.room.players[u].bot);
const hasBots = (t) => t === "shayeb" || t === "basra";
async function addBot() {
  if (!S.isHost) return;
  if (plist().length >= room().max) return toast("الغرفة مليانة.");
  let n = 1; while ((room().players || {})["bot" + n]) n++;
  try { await S.api.set(R("public/players/bot" + n), { name: "🤖 بوت " + n, online: true, bot: true, joined: Date.now() }); } catch (e) { toast("تعذّر إضافة البوت."); }
}
async function delBot(u) { if (S.isHost && isBot(u)) { try { await S.api.set(R("public/players/" + u), null); } catch (e) {} } }
const handsPriv = () => { const o = {}; H.order.forEach((u) => { if (!isBot(u)) o[u] = { hand: H.hands[u] }; }); return o; };

/* ------------------------------ الشايب ------------------------------ */
const SH_TURN = 30000;
function shPub(extra) {
  const size = {}; H.order.forEach((u) => { size[u] = H.hands[u].length; });
  return Object.assign({ order: H.order, size, pairs: H.pairs, out: H.out, cur: H.cur, target: H.target || "", msg: H.msg || "", losses: H.losses }, extra);
}
function shPairs(u) {
  const by = {}, keep = [];
  H.hands[u].forEach((c) => { if (c.j) keep.push(c); else (by[c.r] = by[c.r] || []).push(c); });
  Object.keys(by).forEach((r) => { H.pairs[u] += Math.floor(by[r].length / 2); if (by[r].length % 2) keep.push(by[r][0]); });
  H.hands[u] = shuf(keep);
}
const shNext = (from) => { const o = H.order, i = o.indexOf(from); for (let k = 1; k <= o.length; k++) { const u = o[(i + k) % o.length]; if (!H.out[u]) return u; } return null; };
const shRemaining = () => H.order.filter((u) => !H.out[u]);
async function shStart() {
  const ps = active(), old = H && H.type === "shayeb" ? H.losses : {};
  H = base("shayeb", { order: ps.map((p) => p.uid), hands: {}, pairs: {}, out: {}, lastN: {}, losses: old, msg: "" });
  H.order.forEach((u) => { H.hands[u] = []; H.pairs[u] = 0; if (H.losses[u] == null) H.losses[u] = 0; });
  pcDeck(true).forEach((c, i) => H.hands[H.order[i % H.order.length]].push(c));
  H.order.forEach(shPairs);
  H.order.forEach((u) => { if (!H.hands[u].length) H.out[u] = true; });
  H.msg = "اتوزعت الكروت واتشالت الأزواج 🃏";
  H.cur = H.order.find((u) => !H.out[u]);
  if (shRemaining().length <= 1) return shEnd();
  await shTurn();
}
async function shTurn() {
  clearTimeout(H.timer);
  H.target = shNext(H.cur);
  await pushState(shPub({ phase: "play", endsAt: now() + SH_TURN }), handsPriv());
  const online = ((room().players || {})[H.cur] || {}).online !== false;
  after(isBot(H.cur) ? 1100 : online ? SH_TURN : 1500, () => shDraw(Math.floor(Math.random() * H.hands[H.target].length)));
}
async function shDraw(k) {
  clearTimeout(H.timer);
  const cur = H.cur, tg = H.target, th = H.hands[tg], mine = H.hands[cur];
  if (!Number.isInteger(k) || k < 0 || k >= th.length) return;
  const c = th.splice(k, 1)[0], mi = c.j ? -1 : mine.findIndex((x) => !x.j && x.r === c.r);
  if (mi >= 0) { mine.splice(mi, 1); H.pairs[cur]++; H.msg = nameOf(cur) + " سحب من " + nameOf(tg) + " وكمّل زوج " + PC_RANK(c.r) + " ✨"; }
  else { mine.splice(Math.floor(Math.random() * (mine.length + 1)), 0, c); H.msg = nameOf(cur) + " سحب كارت من " + nameOf(tg); }
  if (!th.length) { H.out[tg] = true; H.msg += " — " + nameOf(tg) + " خلّص كروته ✅"; }
  if (!mine.length) { H.out[cur] = true; H.msg += " — " + nameOf(cur) + " خلّص كروته ✅"; }
  if (shRemaining().length <= 1) return shEnd();
  H.cur = !H.out[tg] ? tg : shNext(tg);
  await shTurn();
}
async function shEnd() {
  clearTimeout(H.timer);
  const rem = shRemaining(); const loser = rem[0] || H.order.find((u) => H.hands[u].some((c) => c.j));
  H.losses[loser] = (H.losses[loser] || 0) + 1;
  await pushState(shPub({ phase: "end", shayeb: loser, cur: "" }), handsPriv());
}

/* ------------------------------- بصرة ------------------------------- */
const BS_TURN = 40000, BS_TARGET = 101;
const bsPts = (c) => (c.r === 10 && c.s === 2 ? 3 : c.r === 2 && c.s === 3 ? 2 : c.r === 1 || c.r === 11 ? 1 : 0);
function bsBestSums(items, target) {
  items = items.slice(0, 14); const n = items.length, subs = [];
  (function rec(i, sum, mask) { if (sum === target) { subs.push(mask); return; } if (sum > target || i >= n) return; rec(i + 1, sum + items[i].v, mask | (1 << i)); rec(i + 1, sum, mask); })(0, 0, 0);
  const pc = (m) => { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; };
  let best = 0, bestMask = 0;
  (function pick(j, used, cnt) { if (cnt > best) { best = cnt; bestMask = used; } for (let k = j; k < subs.length; k++) if (!(subs[k] & used)) pick(k + 1, used | subs[k], cnt + pc(subs[k])); })(0, 0, 0);
  return items.filter((_, i) => bestMask & (1 << i)).map((x) => x.i);
}
function bsCapture(card, table) {
  if (card.r === 11) return table.length ? table.map((_, i) => i) : null;
  const take = []; table.forEach((t, i) => { if (t.r === card.r) take.push(i); });
  if (card.r <= 10) {
    const cand = []; table.forEach((t, i) => { if (t.r < card.r) cand.push({ i, v: t.r }); });
    bsBestSums(cand, card.r).forEach((i) => take.push(i));
  }
  return take.length ? take : null;
}
function bsPick(hand, table) {
  let bi = 0, bs = -1e9;
  hand.forEach((c, i) => {
    const cap = bsCapture(c, table); let s;
    if (cap) {
      const tp = cap.reduce((a, x) => a + bsPts(table[x]), 0) + bsPts(c), clear = c.r !== 11 && cap.length === table.length;
      s = 10 + cap.length * 3 + tp * 4 + (clear ? 25 : 0) - (c.r === 11 && cap.length < 3 ? 12 : 0);
    } else s = -c.r * 0.5 - (c.r === 11 ? 40 : 0) - bsPts(c) * 3;
    if (s > bs) { bs = s; bi = i; }
  });
  return bi;
}
const bsTeam = (u) => H.team[u];
function bsPub(extra) {
  const size = {}, capN = {}; H.order.forEach((u) => { size[u] = H.hands[u].length; capN[u] = H.captured[u].length; });
  return Object.assign({ order: H.order, team: H.team, table: H.table, size, capN, basras: H.basras, deckN: H.deck.length, scores: H.scores, cur: H.cur, last: H.last || 0, msg: H.msg || "", round: H.round, target: BS_TARGET }, extra);
}
async function bsStart() {
  const ps = active(), n = ps.length;
  H = base("basra", { order: ps.map((p) => p.uid), team: {}, hands: {}, captured: {}, basras: {}, table: [], deck: [], scores: [0, 0], round: 0, lastN: {}, msg: "" });
  H.order.forEach((u, i) => { H.team[u] = n === 4 ? i % 2 : i; });
  await bsDeck();
}
async function bsDeck() {
  H.round++; H.deck = pcDeck(false); H.table = []; H.lastCap = null; H.last = 0; H.msg = "";
  H.order.forEach((u) => { H.captured[u] = []; H.basras[u] = 0; H.hands[u] = []; });
  while (H.table.length < 4) { const c = H.deck.pop(); if (c.r === 11) H.deck.unshift(c); else H.table.push(c); }
  H.order.forEach((u) => { for (let k = 0; k < 4; k++) H.hands[u].push(H.deck.pop()); });
  H.cur = H.order[(H.round - 1) % H.order.length];
  await bsTurn();
}
async function bsTurn() {
  clearTimeout(H.timer);
  await pushState(bsPub({ phase: "play", endsAt: now() + BS_TURN }), handsPriv());
  const online = ((room().players || {})[H.cur] || {}).online !== false;
  after(isBot(H.cur) ? 1300 : online ? BS_TURN : 1500, () => bsPlay(bsPick(H.hands[H.cur], H.table)));
}
async function bsPlay(k) {
  clearTimeout(H.timer);
  const u = H.cur, hand = H.hands[u];
  if (!Number.isInteger(k) || k < 0 || k >= hand.length) return;
  const c = hand.splice(k, 1)[0], cap = bsCapture(c, H.table); let basra = false, took = 0;
  if (cap) {
    const taken = cap.map((i) => H.table[i]); took = taken.length;
    H.table = H.table.filter((_, i) => !cap.includes(i)); H.captured[u].push(c, ...taken); H.lastCap = u;
    basra = c.r !== 11 && H.table.length === 0; if (basra) H.basras[u]++;
    H.msg = nameOf(u) + " لعب " + PC_RANK(c.r) + PC_SUIT[c.s] + " وأخد " + took + " كارت" + (basra ? " — 🔥 بصرة! +10" : "");
  } else { H.table.push(c); H.msg = nameOf(u) + " نزّل " + PC_RANK(c.r) + PC_SUIT[c.s]; }
  H.last = { by: u, c, took, basra: basra ? 1 : 0 };
  H.cur = H.order[(H.order.indexOf(u) + 1) % H.order.length];
  if (H.order.every((x) => !H.hands[x].length)) {
    if (H.deck.length >= 4 * H.order.length) H.order.forEach((x) => { for (let i = 0; i < 4; i++) H.hands[x].push(H.deck.pop()); });
    else return bsRoundEnd();
  }
  await bsTurn();
}
async function bsRoundEnd() {
  clearTimeout(H.timer);
  if (H.table.length && H.lastCap) { H.captured[H.lastCap].push(...H.table); H.msg = "باقي كروت الأرض راحت لـ " + nameOf(H.lastCap); H.table = []; }
  const nT = 2, det = [0, 1].map(() => ({ cards: 0, pts: 0, basras: 0, most: 0, total: 0 }));
  H.order.forEach((u) => { const d = det[bsTeam(u)]; d.cards += H.captured[u].length; d.pts += H.captured[u].reduce((a, c) => a + bsPts(c), 0); d.basras += H.basras[u]; });
  if (det[0].cards !== det[1].cards) det[det[0].cards > det[1].cards ? 0 : 1].most = 30;
  det.forEach((d, t) => { d.total = d.pts + d.basras * 10 + d.most; H.scores[t] += d.total; });
  const win = H.scores[0] >= BS_TARGET || H.scores[1] >= BS_TARGET ? (H.scores[0] > H.scores[1] ? 0 : H.scores[1] > H.scores[0] ? 1 : -1) : -1;
  H.over = win >= 0; H.win = win;
  await pushState({ phase: "roundEnd", order: H.order, team: H.team, scores: H.scores, det, round: H.round, over: H.over ? 1 : 0, win, target: BS_TARGET, msg: H.msg, endsAt: now() + 40000 }, handsPriv());
  after(40000, bsNext);
}
async function bsNext() {
  clearTimeout(H.timer);
  if (H.over) return pushState({ phase: "end", order: H.order, team: H.team, scores: H.scores, win: H.win, target: BS_TARGET }, handsPriv());
  await bsDeck();
}
function cardsTick() {
  const ph = st().phase, inp = inputsNow(), parts = active().filter((p) => H.order.includes(p.uid));
  if (ph === "play") {
    const i = inp[H.cur], v = i && i.val;
    if (v && typeof v === "object" && v.n > (H.lastN[H.cur] || 0)) {
      H.lastN[H.cur] = v.n;
      if (H.type === "shayeb" && v.a === "draw") shDraw(v.k); else if (H.type === "basra" && v.a === "play") bsPlay(v.k);
    }
  } else if (ph === "roundEnd" && H.type === "basra") { if (parts.length && parts.every((p) => isBot(p.uid) || inp[p.uid])) bsNext(); }
}

/* ---- واجهة الشايب وبصرة ---- */
let cN = 0;
const cSend = (v) => sendInput(Object.assign({ n: ++cN }, v));
const pcRow = (cards, cls) => (cards || []).map((c) => pcFace(c, cls)).join("");
function vShayeb(s, ph) {
  const me = S.uid, order = s.order || [], myHand = pcSort(S.priv && S.priv.hand), loss = s.losses || {};
  const lossBoard = `<div class="scoreboard">` + order.map((u) => `<span class="chip">${esc(nameOf(u))}: ${loss[u] || 0} 🃏</span>`).join("") + `</div>`;
  if (ph === "end") {
    return `<div class="big-card" style="margin-top:14px"><div class="big-word" style="color:${s.shayeb === me ? "#ef4444" : "#22c55e"}">${s.shayeb === me ? "😅 إنت الشايب!" : "🎉 " + esc(nameOf(s.shayeb)) + " هو الشايب!"}</div>
      <div class="center">${pcFace({ j: 1 }, "big")}</div></div><p class="muted center">عدد مرات الشايب في الغرفة:</p>${lossBoard}${endButtons()}`;
  }
  const out = s.out || {}, size = s.size || {}, myTurn = s.cur === me;
  const opps = order.filter((u) => u !== me).map((u) => {
    const tg = myTurn && s.target === u, n = size[u] || 0;
    const backs = out[u] ? `<span class="muted">خلّص كروته ✅</span>` : Array.from({ length: n }, (_, k) => tg ? `<button class="pc-btn" onclick="OL.shDraw(${k})">${pcBack("sm")}</button>` : pcBack("sm")).join("");
    return `<div class="sc-opp${s.cur === u ? " turn" : ""}${tg ? " tgt" : ""}"><div class="sc-name">${esc(nameOf(u))} (${n}) ${s.cur === u ? "⏳" : ""} <small>أزواج: ${(s.pairs || {})[u] || 0}</small></div><div class="pc-row">${backs}</div></div>`;
  }).join("");
  const status = out[me] ? `<p class="center">✅ خلّصت كروتك! استنى الباقي...</p>` : myTurn ? `<p class="center"><b>دورك!</b> اسحب كارت من <b>${esc(nameOf(s.target))}</b> 👆 (اضغط على كارت من كروته)</p>` : `<p class="muted center">⏳ دور ${esc(nameOf(s.cur))} بيسحب من ${esc(nameOf(s.target))}</p>`;
  return `<div style="margin-top:12px">${lossBoard}</div><div class="sc-opps">${opps}</div><div class="sc-msg">${esc(s.msg || "")}</div>${timerHtml(s.endsAt)}${status}
    <div class="sc-me${myTurn ? " turn" : ""}"><div class="sc-name">كروتك (${myHand.length}) <small>أزواج: ${(s.pairs || {})[me] || 0}</small></div><div class="pc-row mine">${pcRow(myHand)}</div></div>${hostBtn("⏭ تخطي الدور")}`;
}
function vBasra(s, ph) {
  const me = S.uid, order = s.order || [], team = s.team || {}, sc = s.scores || [0, 0], n = order.length;
  const tName = (t) => n === 4 ? "فريق " + order.filter((u) => team[u] === t).map(nameOf).join(" + ") : order.filter((u) => team[u] === t).map(nameOf).join("");
  const board = `<div class="scoreboard">` + [0, 1].map((t) => `<span class="chip${team[me] === t ? " turn" : ""}">${esc(tName(t))}: ${sc[t] || 0}</span>`).join("") + `<span class="chip">🎯 الهدف ${s.target}</span></div>`;
  if (ph === "end") {
    const mine = team[me] === s.win;
    return `<div class="big-card" style="margin-top:14px"><div class="big-word" style="color:${mine ? "#22c55e" : "#ef4444"}">${mine ? "🏆 كسبتوا!" : "😢 خسرتوا"}</div><p>الفايز: <b>${esc(tName(s.win))}</b></p></div>${board}${endButtons()}`;
  }
  if (ph === "roundEnd") {
    const rows = [0, 1].map((t) => { const d = s.det[t]; return `<div class="sc-rrow${(sc[t] || 0) === Math.max(sc[0], sc[1]) ? " first" : ""}"><div class="sc-name">${esc(tName(t))}</div><div class="sc-pts">كروت: ${d.cards}${d.most ? " (+30 الأكتر)" : ""} · نقاط الكروت: ${d.pts} · بصرات: ${d.basras} (+${d.basras * 10})<br><b>+${d.total}</b> ← الإجمالي ${sc[t]}</div></div>`; }).join("");
    return `<h3 class="center" style="margin:14px 0">📊 نتيجة الجولة ${s.round}</h3>${rows}<p class="muted center">${esc(s.msg || "")}</p><div class="center">${myInput() ? `<p class="muted">✅ استنى الباقي...</p>` : `<button class="primary-btn" onclick="OL.ready()">${s.over ? "عرض النتيجة النهائية 🏁" : "الجولة اللي بعدها ➡️"}</button>`}${hostBtn("⏭ كمّل")}</div>`;
  }
  const myTurn = s.cur === me, size = s.size || {}, capN = s.capN || {}, bas = s.basras || {}, last = s.last || null;
  const myHand = (S.priv && S.priv.hand) || [];
  const opps = order.filter((u) => u !== me).map((u) => `<div class="sc-opp${s.cur === u ? " turn" : ""}"><div class="sc-name">${esc(nameOf(u))} ${s.cur === u ? "⏳" : ""}${n === 4 && team[u] === team[me] ? " 🤝" : ""}</div><div class="pc-row">${Array.from({ length: size[u] || 0 }, () => pcBack("sm")).join("")}</div><small class="muted">مكسب: ${capN[u] || 0} كارت · بصرات: ${bas[u] || 0}</small></div>`).join("");
  const table = (s.table || []).length ? pcRow(s.table, "tbl") : `<span class="muted">الأرض فاضية</span>`;
  const hand = myHand.map((c, i) => `<button class="pc-btn${myTurn ? " pick" : ""}" ${myTurn ? `onclick="OL.bsPlay(${i})"` : "disabled"}>${pcFace(c)}</button>`).join("");
  return `<div style="margin-top:12px">${board}</div><div class="sc-opps">${opps}</div>
    <div class="sc-table2"><div class="pc-row tblrow">${table}</div><small class="muted">الدسته: ${s.deckN} · جولة ${s.round}</small></div>
    <div class="sc-msg">${esc(s.msg || "")}</div>${timerHtml(s.endsAt)}
    <p class="${myTurn ? "center" : "muted center"}">${myTurn ? "<b>دورك!</b> اضغط على كارت من كروتك تلعبه 👆" : "⏳ دور " + esc(nameOf(s.cur))}</p>
    <div class="sc-me${myTurn ? " turn" : ""}"><div class="sc-name">كروتك — مكسبك ${capN[me] || 0} كارت · بصراتك ${bas[me] || 0}</div><div class="pc-row mine">${hand}</div></div>${hostBtn("⏭ تخطي الدور")}`;
}

/* ------------------------- أوامر الأزرار (OL) ------------------------- */
let chN = 0;
window.OL = {
  create: openCreate, setMax: (n) => { cMax = n; renderCreate(); }, confirmCreate, leave, share, rename,
  slot: scSlot, addBot, delBot,
  shDraw: (k) => cSend({ a: "draw", k }),
  bsPlay: (k) => cSend({ a: "play", k }),
  scDo: (a) => scSend({ a }),
  scMode: (m) => { U.mode = m; renderRoom(); },
  scPeekOk: () => sendInput(U.sel.slice()),
  scOthers: () => scSend({ a: "others", picks: Object.assign({}, U.o) }),
  _H: () => H,
  start: hostStart, again: hostAgain, force: hostForce, next: hostNext, quick: quickMatch,
  say: () => {
    const el = g("ol-msg"), s = st(); if (!el) return;
    const text = el.value.trim().slice(0, 200); if (!text) return;
    el.value = "";
    S.api.set(R("public/chat/" + s.cid + "_" + s.idx + "_" + Date.now()), { uid: S.uid, text, cid: s.cid, idx: s.idx, t: now() }).catch(() => toast("تعذّر الإرسال."));
  },
  done: () => sendInput({ t: "done" }),
  vJoin: () => voiceJoin(), vLeave: () => voiceLeave(), vMute: () => voiceMute(),
  answer: (i) => sendInput(i),
  ready: () => sendInput(true),
  vote: (u) => sendInput(u),
  peek: () => { S.peek = !S.peek; renderRoom(); },
  pick: () => { S.picking = true; renderRoom(); },
  skip: () => sendInput({ t: "skip", n: ++chN }),
  guessed: (u) => { S.picking = false; sendInput({ t: "guessed", g: u, n: ++chN }); },
  openJoin: () => { g("ol-join-overlay").classList.remove("hidden"); setTimeout(() => g("ol-code-in").focus(), 50); },
  join: () => joinRoom(g("ol-code-in").value)
};

/* ------------------------- حقن الواجهة في الصفحة ------------------------- */
function injectUI() {
  if (document.getElementById("online-view")) return;
  const cont = document.querySelector(".container");
  const v = document.createElement("div");
  v.id = "online-view"; v.className = "view-section hidden"; v.setAttribute("data-view", "");
  cont.appendChild(v);

  const hero = document.querySelector(".hero-section");
  if (hero && !document.querySelector('[onclick*="OL.openJoin"]')) {
    const j = document.createElement("div"); j.className = "center"; j.style.marginTop = "14px";
    j.innerHTML = '<button class="ghost-btn ol-join-btn" onclick="OL.openJoin()">🔑 ادخل غرفة بكود (أونلاين)</button>';
    hero.appendChild(j);
  }
  const stat = g("ol-create-static");
  const startBtn = stat ? null : document.querySelector("#setup-view .primary-btn");
  const mkQuick = () => { const q = document.createElement("button"); q.className = "ghost-btn ol-create-btn"; q.textContent = "⚡ لعب عشوائي مع ناس"; q.onclick = () => OL.quick(); return q; };
  if (startBtn) {
    const b = document.createElement("button");
    b.className = "ghost-btn ol-create-btn"; b.textContent = "🌐 العب أونلاين مع أصحابك";
    b.onclick = () => OL.create();
    startBtn.insertAdjacentElement("afterend", b);
    b.insertAdjacentElement("afterend", mkQuick());
  } else if (stat && !stat.querySelector(".ol-quick")) {
    const q = mkQuick(); q.classList.add("ol-quick"); q.style.marginTop = "8px"; stat.appendChild(q);
  }
  const ov = document.createElement("div");
  ov.id = "ol-join-overlay"; ov.className = "overlay hidden";
  ov.innerHTML = '<div class="modal"><button class="x-btn" aria-label="إغلاق" onclick="this.closest(\'.overlay\').classList.add(\'hidden\')">✕</button>' +
    '<h3>🔑 ادخل غرفة</h3><p>اكتب كود الغرفة اللي صاحبك بعتهولك (4 أرقام).</p>' +
    '<input class="name-input" id="ol-code-in" inputmode="numeric" maxlength="4" placeholder="1234" style="text-align:center;font-size:1.6rem;letter-spacing:8px" onkeydown="if(event.key===\'Enter\')OL.join()">' +
    '<div class="center"><button class="primary-btn" onclick="OL.join()">دخول 🚀</button></div></div>';
  document.body.appendChild(ov);
  const oc = document.createElement("div");
  oc.id = "ol-create-overlay"; oc.className = "overlay hidden";
  oc.innerHTML = '<div class="modal"><button class="x-btn" aria-label="إغلاق" onclick="this.closest(\'.overlay\').classList.add(\'hidden\')">✕</button>' +
    '<h3>🌐 إعدادات الغرفة</h3><p id="ol-create-title" style="color:#facc15;font-weight:800"></p>' +
    '<p id="ol-create-hint"></p><div class="count-row" id="ol-create-counts"></div>' +
    '<div class="center"><button class="primary-btn" onclick="OL.confirmCreate()">إنشاء الغرفة وأخد الكود 🔑</button></div></div>';
  document.body.appendChild(oc);
}


(async function boot() {
  injectUI();
  // رابط دعوة ?room=1234
  const q = new URLSearchParams(location.search).get("room");
  if (q && /^\d{4}$/.test(q)) { OL.openJoin(); g("ol-code-in").value = q; }
  // رجوع لغرفة بعد ريفريش (اللاعب العادي بس)
  let saved = null; try { saved = JSON.parse(sessionStorage.getItem("mema_room") || "null"); } catch (e) {}
  if (saved && saved.code) {
    if (!(await ready())) return;
    if (saved.host) { S.code = saved.code; await closeRoom(); S.code = null; clearSession(); toast("الغرفة اتقفلت لأنك فارقت الصفحة."); }
    else joinRoom(saved.code, true);
  }
})();
