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
  return Object.keys(p).map((uid) => ({ uid, name: p[uid].name || "لاعب", online: p[uid].online !== false, joined: p[uid].joined || 0, voice: p[uid].voice || 0 }))
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
  if (!fb) { toast("تعذّر تحميل خدمة الأونلاين. تأكد من النت."); return false; }
  const api = window.MEMA_DB_API || (await import(FBV + "firebase-database.js"));
  S.api = api; S.auth = fb.auth; S.db = api.getDatabase(fb.app, DB_URL);
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

async function createRoom(opts) {
  if (!(await ready())) return false;
  const random = !!(opts && opts.random);
  const ch = curChallenge(), type = typeOf(ch), rule = RULES[type];
  const min = type === "quiz" ? 2 : rule.min, max = type === "quiz" ? 8 : rule.max;
  let code = null;
  for (let i = 0; i < 12 && !code; i++) {
    const c = String(Math.floor(1000 + Math.random() * 9000));
    const s = await S.api.get(S.api.ref(S.db, "rooms/" + c + "/public"));
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
  } catch (e) { S.code = null; return toast("تعذّر إنشاء الغرفة. تأكد من قواعد Firebase."); }
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
  await createRoom({ random: true });
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
  S.starting = true;
  if (!chData()) { await loadGame(r.game); }
  if (!chData()) { S.starting = false; return toast("تعذّر تحميل بيانات اللعبة."); }
  dropLobby(); clearTimeout(S.autoT); S.autoT = null;
  await S.api.update(R("public"), { status: "playing", autoAt: null });
  ({ quiz: qzStart, imposter: impStart, mafioso: mfStart, charades: chStart }[r.type])();
}

function hostTick() {
  if (!H || st().step !== H.step) return;
  const ph = st().phase, inp = inputsNow(), act = active();
  if (H.type === "quiz" && ph === "q") {
    if (act.length && act.every((p) => typeof (inp[p.uid] || {}).val === "number")) qzReveal();
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
  else if (H.type === "charades" && ph === "act") chEndTurn("⏭ صاحب الغرفة أنهى الدور. الفيلم كان: " + H.cur);
}
function hostNext() { if (S.isHost && H && (st().phase === "discuss" || st().phase === "round")) turnNext(); }
function hostAgain() {
  if (!S.isHost) return;
  const a = active(); if (a.length < room().min) return toast("محتاج " + room().min + " لاعبين على الأقل.");
  ({ quiz: qzStart, imposter: impStart, mafioso: mfStart, charades: chStart }[room().type])();
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
  Object.keys(inp).forEach((u) => {
    const idx = inp[u].val; if (typeof idx !== "number") return;
    picks[u] = idx;
    if (idx === q.ci) {
      const left = Math.max(0, Math.min(Q_TIME, H.endsAt - inp[u].t));
      const pts = 100 + Math.round((50 * left) / Q_TIME);
      gained[u] = pts; H.scores[u] = (H.scores[u] || 0) + pts;
    }
  });
  await pushState({ phase: "reveal", i: H.i, total: H.qs.length, text: q.text, opts: q.opts, correct: q.ci, picks, gained, scores: H.scores, endsAt: now() + 3500 });
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
  const key = ph + ":" + s.step; if (S.lastKey !== key) { S.lastKey = key; S.peek = false; S.picking = false; }
  let body = "";
  if (ph === "lobby" || r.status === "lobby") body = vLobby();
  else if (r.type === "quiz") body = vQuiz(s, ph);
  else if (r.type === "imposter") body = vImp(s, ph);
  else if (r.type === "mafioso") body = vMaf(s, ph);
  else if (r.type === "charades") body = vCh(s, ph);
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
  const lines = ps.map((p) => `<div class="rank-row"><span>${p.uid === r.host ? "👑 " : ""}${esc(p.name)}${p.uid === S.uid ? " (أنت)" : ""}</span><span>${p.online ? "🟢" : "⚪ غير متصل"}</span></div>`).join("");
  return `<h2 style="color:#38bdf8;margin:14px 0 4px">${esc(r.chName)}</h2>
    <p class="muted">${esc(RULES[r.type].text)}</p>
    ${r.random ? `<p class="muted">🌍 غرفة عشوائية — أي لاعب بيدوّر على لعبة هينضم.</p>` : ""}
    ${r.autoAt ? `<div class="big-card"><p>⏱ اللعبة هتبدأ تلقائياً بعد</p>${timerHtml(r.autoAt)}</div>` : ""}
    <div class="big-card"><p>كود الغرفة — ابعته لأصحابك</p><div class="big-word ol-code">${esc(S.code)}</div>
      <button class="ghost-btn" onclick="OL.share()">📤 شارك الرابط</button></div>
    <label class="muted">اسمك في اللعبة:</label>
    <input class="name-input" id="ol-name" maxlength="14" value="${esc(((room().players || {})[S.uid] || {}).name || "")}" onchange="OL.rename(this.value)">
    <h3 style="margin:14px 0 8px">اللاعبين (${ps.length}/${r.max})</h3>${lines}
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
    foot = (mine === undefined ? "" : `<p class="muted center">✅ إجابتك اتسجّلت. استنى الباقي (${answered}/${active().length})</p>`) + hostBtn("⏭ أنهِ السؤال");
  } else {
    const gained = (s.gained || {})[S.uid];
    foot = `<p class="center" style="margin-top:8px">${gained ? `🎯 +${gained} نقطة` : mine === undefined ? "⏰ ما جاوبتش" : "❌ إجابة غلط"}</p>`;
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
const ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }] };
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

/* ------------------------- أوامر الأزرار (OL) ------------------------- */
let chN = 0;
window.OL = {
  create: createRoom, leave, share, rename,
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
  if (hero) {
    const j = document.createElement("div"); j.className = "center"; j.style.marginTop = "14px";
    j.innerHTML = '<button class="ghost-btn ol-join-btn" onclick="OL.openJoin()">🔑 ادخل غرفة بكود (أونلاين)</button>';
    hero.appendChild(j);
  }
  const startBtn = document.querySelector("#setup-view .primary-btn");
  if (startBtn) {
    const b = document.createElement("button");
    b.className = "ghost-btn ol-create-btn"; b.textContent = "🌐 العب أونلاين مع أصحابك";
    b.onclick = () => OL.create();
    startBtn.insertAdjacentElement("afterend", b);
    const q = document.createElement("button");
    q.className = "ghost-btn ol-create-btn"; q.textContent = "⚡ لعب عشوائي مع ناس";
    q.onclick = () => OL.quick();
    b.insertAdjacentElement("afterend", q);
  }
  const ov = document.createElement("div");
  ov.id = "ol-join-overlay"; ov.className = "overlay hidden";
  ov.innerHTML = '<div class="modal"><button class="x-btn" aria-label="إغلاق" onclick="this.closest(\'.overlay\').classList.add(\'hidden\')">✕</button>' +
    '<h3>🔑 ادخل غرفة</h3><p>اكتب كود الغرفة اللي صاحبك بعتهولك (4 أرقام).</p>' +
    '<input class="name-input" id="ol-code-in" inputmode="numeric" maxlength="4" placeholder="1234" style="text-align:center;font-size:1.6rem;letter-spacing:8px" onkeydown="if(event.key===\'Enter\')OL.join()">' +
    '<div class="center"><button class="primary-btn" onclick="OL.join()">دخول 🚀</button></div></div>';
  document.body.appendChild(ov);
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
