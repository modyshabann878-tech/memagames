/* =====================================================================
   Mema Games — اللعب أونلاين (Firebase Realtime Database)
   - صاحب الغرفة (host) هو اللي بيشغّل منطق اللعبة ويكتب الحالة
   - باقي اللاعبين بيبعتوا إجاباتهم/أصواتهم في inputs/<uid>
   - الأدوار السرية بتتخزن في private/<uid> (اللاعب نفسه بس بيقراها)
   ===================================================================== */

const DB_URL = "https://memagames-9bd95-default-rtdb.europe-west1.firebasedatabase.app";
const FBV = "https://www.gstatic.com/firebasejs/13.3.0/";
const Q_TIME = 15000, CH_TIME = 60000, IMP_TIME = 300000, MF_TIME = 180000;

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
  return Object.keys(p).map((uid) => ({ uid, name: p[uid].name || "لاعب", online: p[uid].online !== false, joined: p[uid].joined || 0 }))
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

async function createRoom() {
  if (!(await ready())) return;
  const ch = curChallenge(), type = typeOf(ch), rule = RULES[type];
  const min = type === "quiz" ? 2 : rule.min, max = type === "quiz" ? 8 : rule.max;
  let code = null;
  for (let i = 0; i < 12 && !code; i++) {
    const c = String(Math.floor(1000 + Math.random() * 9000));
    const s = await S.api.get(S.api.ref(S.db, "rooms/" + c + "/public"));
    if (!s.exists()) code = c;
  }
  if (!code) return toast("حصلت مشكلة، جرّب تاني.");
  S.code = code; S.isHost = true; H = null;
  const nm = myName();
  try { localStorage.setItem("mema_name", nm); } catch (e) {}
  try {
    await S.api.set(R("public"), {
      host: S.uid, game: gameKey, chIndex, chName: ch.name, type, min, max, status: "lobby",
      state: { phase: "lobby", step: 0 },
      players: { [S.uid]: { name: nm, online: true, joined: Date.now() } }
    });
  } catch (e) { S.code = null; return toast("تعذّر إنشاء الغرفة. تأكد من قواعد Firebase."); }
  keepSession(); subscribe();
}

async function joinRoom(code, silent) {
  if (!(await ready())) return;
  code = String(code || "").trim();
  if (!/^\d{4}$/.test(code)) return toast("اكتب كود الغرفة (4 أرقام).");
  let r;
  try { r = (await S.api.get(S.api.ref(S.db, "rooms/" + code + "/public"))).val(); }
  catch (e) { return toast("تعذّر الوصول للغرفة."); }
  if (!r) return silent ? clearSession() : toast("الغرفة دي مش موجودة. اتأكد من الكود.");
  const mine = r.players && r.players[S.uid];
  if (r.host === S.uid) { S.code = code; await closeRoom(); S.code = null; return silent ? null : toast("الغرفة اتقفلت."); }
  if (!mine) {
    if (r.status !== "lobby") return toast("اللعبة بدأت بالفعل.");
    if (Object.keys(r.players || {}).length >= r.max) return toast("الغرفة مليانة.");
  }
  S.code = code; S.isHost = false; H = null;
  const nm = mine ? mine.name : myName();
  try {
    await S.api.set(R("public/players/" + S.uid), { name: nm, online: true, joined: mine ? mine.joined : Date.now() });
  } catch (e) { S.code = null; return toast("تعذّر الدخول للغرفة."); }
  g("ol-join-overlay").classList.add("hidden");
  keepSession(); subscribe();
}

function keepSession() { try { sessionStorage.setItem("mema_room", JSON.stringify({ code: S.code, host: S.isHost })); } catch (e) {} }
function clearSession() { try { sessionStorage.removeItem("mema_room"); } catch (e) {} }

function subscribe() {
  const a = S.api;
  S.unsubs.push(a.onValue(R("public"), (snap) => {
    S.room = snap.val();
    if (!S.room) { if (!S.leaving) toast("الغرفة اتقفلت."); return teardown(true); }
    if (S.isHost && H) hostTick();
    renderRoom();
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
  S.unsubs.forEach((u) => { try { u(); } catch (e) {} }); S.unsubs = [];
  clearInterval(S.clock); if (H && H.timer) clearTimeout(H.timer);
  H = null; S.room = null; S.priv = null; S.code = null; S.isHost = false; S.peek = false; S.picking = false; S.leaving = false; S.lastKey = null;
  clearSession();
  if (goHome) { try { goHome === true && window.goHome(); } catch (e) {} }
}

async function closeRoom() {
  if (!S.code) return;
  const upd = { public: null };
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

async function hostStart() {
  const r = room(), a = active();
  if (a.length < r.min) return toast("محتاج " + r.min + " لاعبين على الأقل.");
  if (!chData()) { await loadGame(r.game); }
  if (!chData()) return toast("تعذّر تحميل بيانات اللعبة.");
  await S.api.update(R("public"), { status: "playing" });
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
    if (ph === "vote" && parts.length && parts.every((p) => inp[p.uid] && typeof inp[p.uid].val === "string")) impResult();
  } else if (H.type === "mafioso") {
    const parts = act.filter((p) => H.parts.includes(p.uid));
    if (ph === "reveal" && parts.length && parts.every((p) => inp[p.uid])) mfRound();
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

/* ------------------------------ Imposter ------------------------------ */
async function impStart() {
  const ch = chData(), ps = active();
  const word = pick(ch.words), imp = pick(ps).uid;
  H = base("imposter", { word, imp, cat: ch.name, parts: ps.map((p) => p.uid) });
  const priv = {};
  ps.forEach((p) => { priv[p.uid] = p.uid === imp ? { role: "imp", cat: ch.name } : { role: "civ", cat: ch.name, word }; });
  await pushState({ phase: "reveal", cat: ch.name, parts: H.parts }, priv);
}
async function impDiscuss() {
  clearTimeout(H.timer);
  await pushState({ phase: "discuss", cat: H.cat, parts: H.parts, endsAt: now() + IMP_TIME });
  after(IMP_TIME, impVote);
}
async function impVote() { clearTimeout(H.timer); await pushState({ phase: "vote", cat: H.cat, parts: H.parts }); }
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
  await pushState({ phase: "reveal", title: sc.title, story: sc.story, count: bad.length, roster, parts: H.parts }, priv);
}
async function mfRound() {
  clearTimeout(H.timer); H.round++;
  const clues = H.sc.clues || [""], clue = clues[Math.min(H.round - 1, clues.length - 1)];
  await pushState({ phase: "round", round: H.round, title: H.sc.title, clue, roster: H.roster, parts: H.parts, endsAt: now() + MF_TIME });
  after(MF_TIME, mfVote);
}
async function mfVote() { clearTimeout(H.timer); await pushState({ phase: "vote", round: H.round, roster: H.roster, parts: H.parts }); }
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
  const ae = document.activeElement, keep = ae && ae.id === "ol-name" ? { v: ae.value, p: ae.selectionStart } : null;
  const key = ph + ":" + s.step; if (S.lastKey !== key) { S.lastKey = key; S.peek = false; S.picking = false; }
  let body = "";
  if (ph === "lobby" || r.status === "lobby") body = vLobby();
  else if (r.type === "quiz") body = vQuiz(s, ph);
  else if (r.type === "imposter") body = vImp(s, ph);
  else if (r.type === "mafioso") body = vMaf(s, ph);
  else if (r.type === "charades") body = vCh(s, ph);
  v.innerHTML = `<button class="back-btn" onclick="OL.leave()">← خروج من الغرفة</button>
    <span class="chip" style="margin-inline-start:8px">🔑 ${esc(S.code)}</span>` + body;
  if (keep) { const i = g("ol-name"); if (i) { i.value = keep.v; i.focus(); try { i.setSelectionRange(keep.p, keep.p); } catch (e) {} } }
  tickClock();
}

function vLobby() {
  const r = room(), ps = plist(), n = ps.filter((p) => p.online).length, can = n >= r.min;
  const lines = ps.map((p) => `<div class="rank-row"><span>${p.uid === r.host ? "👑 " : ""}${esc(p.name)}${p.uid === S.uid ? " (أنت)" : ""}</span><span>${p.online ? "🟢" : "⚪ غير متصل"}</span></div>`).join("");
  return `<h2 style="color:#38bdf8;margin:14px 0 4px">${esc(r.chName)}</h2>
    <p class="muted">${esc(RULES[r.type].text)}</p>
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
    return `<div class="big-card" style="margin-top:14px"><h3>💬 وقت النقاش</h3><p class="muted">الفئة: ${esc(s.cat)}. كل واحد يسأل التاني من غير ما يقول الكلمة. المخادع لازم يتخفّى!</p>
      ${timerHtml(s.endsAt, "ms")}
      <button class="ghost-btn" onclick="OL.peek()">👀 ${S.peek ? mine : "فكّرني بدوري"}</button></div>${hostBtn("ابدأ التصويت 🗳️")}`;
  }
  if (ph === "vote") {
    const mine = myInput();
    if (mine) return `<div class="big-card" style="margin-top:14px"><div class="big-word">🗳️</div><p>صوّتّ لـ <b>${esc(nameOf(mine))}</b>. استنى الباقي (${Object.keys(inputsNowView()).length}/${parts.length})</p></div>${hostBtn("اعرض النتيجة")}`;
    return `<h3 class="center" style="margin:14px 0 12px">مين المخادع في رأيك؟</h3>` +
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
      <p class="muted" style="margin-top:10px">اتناقشوا: كل واحد يتكلم بشخصيته.</p>${timerHtml(s.endsAt, "ms")}</div>
      <div class="center"><button class="ghost-btn" onclick="OL.peek()">👀 ${S.peek && P ? (P.mafia ? "😈 مجرم" : "😇 بريء") + " — " + esc(P.role) : "فكّرني بدوري"}</button></div>${hostBtn("ابدأ التصويت 🗳️")}`;
  }
  if (ph === "vote") {
    const mine = myInput();
    if (!alive) return rosterChips(s.roster) + `<p class="muted center">إنت خارج اللعبة. تابع التصويت... 👀</p>${hostBtn("اعرض النتيجة")}`;
    if (mine) return rosterChips(s.roster) + `<div class="big-card"><p>🗳️ صوّتّ لـ <b>${esc(nameOf(mine))}</b>. استنى الباقي.</p></div>${hostBtn("اعرض النتيجة")}`;
    return rosterChips(s.roster) + `<h3 class="center" style="margin:14px 0 12px">مين يخرج من اللعبة؟</h3>` +
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

/* ------------------------- أوامر الأزرار (OL) ------------------------- */
let chN = 0;
window.OL = {
  create: createRoom, leave, share, rename,
  start: hostStart, again: hostAgain, force: hostForce,
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
