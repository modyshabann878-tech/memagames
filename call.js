/* Mema Games — مكالمة فيديو (360p) داخل الغرفة
   مستقل تماماً عن الصوت القديم (online.js): مفيش أي تعديل عليه.
   - بيقرا كود الغرفة من الجلسة، ويستخدم نفس تسجيل الدخول والداتابيز.
   - الإشارات بتعدّي على Firebase في rooms/<code>/rtc
   - الأيقونة والمربعات بتتسحب في أي مكان على الشاشة. */
(function () {
  "use strict";
  const DB_URL = "https://memagames-9bd95-default-rtdb.europe-west1.firebasedatabase.app";
  const FBV = "https://www.gstatic.com/firebasejs/13.3.0/";
  const ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }] };
  const VIDEO = { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 20, max: 24 } };
  const POS_KEY = "mema_vcall_pos";

  let api = null, db = null, uid = null, code = null, players = {};
  let on = false, cam = null, mic = null, busy = false;
  const peers = {};                                   // uid -> {pc, sid, stream, seen, queue, off}
  let unsubs = [], dock = null, fab = null;

  const el = (t, css, html) => { const e = document.createElement(t); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; };
  const ref = (p) => api.ref(db, "rooms/" + code + "/" + p);
  const toast = (t) => {
    const d = el("div", "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#0f172a;color:#f8fafc;border:2px solid #38bdf8;padding:10px 16px;border-radius:12px;z-index:9999;max-width:90vw;text-align:center", "");
    d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3200);
  };

  /* ---------------- شريط تشخيص (اضغط عليه يختفي) ---------------- */
  const logs = []; let dbgEl = null, dbgHide = false;
  const sh = (x) => String(x || "").slice(0, 4);
  function statusLine() {
    const vcN = Object.keys(players).filter((u) => players[u] && players[u].vc).length;
    return "room=" + code + " me=" + sh(uid) + " on=" + on + " cam=" + !!cam + " players=" + Object.keys(players).length + " vc=" + vcN +
      " peers=" + Object.keys(peers).map((u) => sh(u) + ":" + peers[u].pc.connectionState + "/" + peers[u].pc.iceConnectionState + "/v" + peers[u].stream.getVideoTracks().length).join(",");
  }
  function drawDbg() {
    if (dbgHide || !code) { if (dbgEl) dbgEl.style.display = "none"; return; }
    if (!dbgEl) {
      dbgEl = el("div", "position:fixed;top:0;left:0;right:0;z-index:99999;background:#000d;color:#9f9;font:10px/1.35 monospace;padding:3px 6px;direction:ltr;text-align:left;white-space:pre-wrap;max-height:34vh;overflow:auto");
      dbgEl.onclick = () => { dbgHide = true; dbgEl.style.display = "none"; };
      document.body.appendChild(dbgEl);
    }
    dbgEl.style.display = "block"; dbgEl.textContent = statusLine() + "\n" + logs.join("\n");
  }
  function dbg(m) { logs.push(new Date().toTimeString().slice(3, 8) + " " + m); if (logs.length > 8) logs.shift(); console.log("[vcall]", m); drawDbg(); }
  const playTile = (u) => { const t = tiles[u]; if (t && t._v && t._v.paused) t._v.play().catch(() => {}); };

  /* ---------------- تجهيز Firebase ---------------- */
  async function init() {
    if (api) return true;
    try {
      const fb = await window.MEMA_FB_READY; if (!fb) return false;
      const a = window.MEMA_DB_API || (await import(FBV + "firebase-database.js"));
      db = a.getDatabase(fb.app, DB_URL);
      if (fb.auth.authStateReady) await fb.auth.authStateReady();
      uid = fb.auth.currentUser && fb.auth.currentUser.uid;
      if (!uid) { console.warn("call: no uid"); return false; }
      api = a; return true;
    } catch (e) { console.warn("call init", e); return false; }
  }
  function roomCode() {
    try { const s = JSON.parse(sessionStorage.getItem("mema_room") || "null"); return s && s.code ? String(s.code) : null; } catch (e) { return null; }
  }

  /* ---------------- واجهة: فقاعات زي ماسنجر ---------------- */
  const loadPos = () => { try { return JSON.parse(localStorage.getItem(POS_KEY)) || null; } catch (e) { return null; } };
  const savePos = (x, y) => { try { localStorage.setItem(POS_KEY, JSON.stringify({ x, y })); } catch (e) {} };
  let bigU = null;                                    // مين متكبّر دلوقتي
  const tiles = {};                                   // uid | "me" -> عنصر

  function buildDock() {
    if (dock) return;
    dock = el("div", "position:fixed;z-index:9500;top:90px;left:8px;display:none;flex-direction:column;align-items:center;gap:10px;direction:rtl;font-family:inherit;touch-action:none");
    const p = loadPos(); if (p) { dock.style.left = Math.max(0, Math.min(p.x, innerWidth - 70)) + "px"; dock.style.top = Math.max(0, Math.min(p.y, innerHeight - 90)) + "px"; }
    document.body.appendChild(dock);
    fab = el("button", "position:fixed;z-index:9400;left:8px;top:90px;width:52px;height:52px;border-radius:50%;border:2px solid #38bdf8;background:#0f172a;color:#fff;font-size:24px;display:none;touch-action:none", "📹");
    fab.onclick = () => toggle(); document.body.appendChild(fab);
    renderUI();
  }

  function wireDrag(node, u) {
    let sx, sy, ox, oy, moved = false, act = false;
    node.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      act = true; moved = false; sx = e.clientX; sy = e.clientY;
      const r = dock.getBoundingClientRect(); ox = r.left; oy = r.top;
      try { node.setPointerCapture(e.pointerId); } catch (x) {}
    });
    node.addEventListener("pointermove", (e) => {
      if (!act) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      dock.style.left = Math.min(Math.max(0, ox + dx), innerWidth - 70) + "px";
      dock.style.top = Math.min(Math.max(0, oy + dy), innerHeight - 90) + "px";
    });
    node.addEventListener("pointerup", () => {
      if (!act) return; act = false;
      if (moved) { const r = dock.getBoundingClientRect(); savePos(Math.round(r.left), Math.round(r.top)); return; }
      bigU = bigU === u ? null : u; renderUI();
    });
    node.addEventListener("pointercancel", () => { act = false; });
  }

  function cbtn(label, fn, bg) {
    const b = el("button", "width:38px;height:38px;border-radius:50%;border:0;background:" + (bg || "#1e293bcc") + ";color:#fff;font-size:17px;cursor:pointer", label);
    b.onclick = (e) => { e.stopPropagation(); fn(); }; return b;
  }
  function mkTile(u) {
    const t = el("div", "position:relative;overflow:hidden;background:#0b1224;border:3px solid #38bdf8;box-shadow:0 6px 18px #000a;cursor:grab;touch-action:none;flex:none");
    const v = el("video"); v.autoplay = true; v.playsInline = true; v.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;pointer-events:none";
    if (u === "me") { v.muted = true; v.style.transform = "scaleX(-1)"; }
    const av = el("div", "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#1e293b;color:#fff;font-weight:900;font-size:26px;pointer-events:none");
    const nm = el("div", "position:absolute;bottom:0;left:0;right:0;background:#000a;color:#fff;font-size:10px;text-align:center;padding:1px 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none");
    const ctl = el("div", "position:absolute;top:6px;left:6px;right:6px;display:none;gap:6px;justify-content:center;z-index:3");
    t.append(v, av, nm, ctl); t._v = v; t._av = av; t._nm = nm; t._ctl = ctl;
    wireDrag(t, u); return t;
  }
  function selfStream() { if (!_ss || _ss.getVideoTracks()[0] !== cam) _ss = cam ? new MediaStream([cam]) : null; return _ss; }
  let _ss = null;

  function renderUI() {
    if (!dock) return;
    const showFab = !document.getElementById("ol-voice") || document.getElementById("ol-voice").style.display === "none";
    fab.style.display = showFab && !on ? "block" : "none";
    const ids = on ? ["me"].concat(Object.keys(players).filter((u) => u !== uid && players[u] && players[u].vc && players[u].online !== false && !players[u].bot)) : [];
    Object.keys(tiles).forEach((k) => { if (!ids.includes(k)) { tiles[k].remove(); delete tiles[k]; } });
    if (bigU && !ids.includes(bigU)) bigU = null;
    ids.forEach((u) => {
      const t = tiles[u] || (tiles[u] = mkTile(u));
      if (t.parentNode !== dock) dock.appendChild(t);
      const isBig = bigU === u, p = u === "me" ? players[uid] || {} : players[u] || {};
      const w = isBig ? Math.min(innerWidth - 24, 300) : 68, h = isBig ? Math.min(Math.round(innerHeight * 0.55), 400) : 68;
      t.style.width = w + "px"; t.style.height = h + "px"; t.style.borderRadius = isBig ? "18px" : "50%";
      t.style.borderColor = u === "me" ? "#4ade80" : "#38bdf8";
      t._nm.textContent = u === "me" ? "أنا" : (p.name || "لاعب"); t._nm.style.display = isBig ? "block" : "none";
      const vt = u !== "me" && peers[u] && peers[u].stream.getVideoTracks()[0];
      const camOn = u === "me" ? !!cam : !!(vt && !vt.muted && p.cam !== false);
      const src = u === "me" ? selfStream() : peers[u] && peers[u].stream;
      if (t._v.srcObject !== src) { t._v.srcObject = src || null; if (src) t._v.play().catch(() => {}); }
      t._av.style.display = camOn ? "none" : "flex";
      t._av.textContent = ((u === "me" ? (p.name || "أنا") : (p.name || "؟")).trim()[0] || "؟");
      t._ctl.style.display = isBig ? "flex" : "none"; t._ctl.innerHTML = "";
      if (isBig) { if (u === "me") t._ctl.append(cbtn(cam ? "📷" : "🚫", toggleCam), cbtn(mic ? "🎤" : "🔇", toggleMic)); t._ctl.append(cbtn("⤡", () => { bigU = null; renderUI(); }), cbtn("📵", () => hangup(), "#b91c1c")); }
    });
    dock.style.display = ids.length ? "flex" : "none";
    paint();
  }
  function paint() {
    const b = document.getElementById("ol-vcam"); if (!b) return;
    const n = Object.keys(players).filter((u) => players[u] && players[u].vc && players[u].online !== false).length;
    b.classList.toggle("on", on);
    b.textContent = busy ? "⏳ ثواني" : on ? "📹 خروج" + (n > 1 ? " (" + n + ")" : "") : "📹 فيديو" + (n ? " (" + n + ")" : "");
  }
  const refreshTiles = renderUI;
  const removeTile = () => {};
  const ensureTile = () => {};

  /* ---------------- ميديا ---------------- */
  const myRef = (k) => ref("public/players/" + uid + "/" + k);
  const setP = (k, v) => { try { api.set(myRef(k), v).catch((e) => { console.warn("vcall set", e); dbg("رفض كتابة " + k + ": " + (e && (e.code || e.message))); }); } catch (e) {} };
  async function getCam() { if (cam) return cam; const s = await navigator.mediaDevices.getUserMedia({ video: Object.assign({ facingMode: "user" }, VIDEO) }); cam = s.getVideoTracks()[0]; return cam; }
  async function getMic() { if (mic) return mic; const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); mic = s.getAudioTracks()[0]; return mic; }
  function attach(pc) {
    pc.getTransceivers().forEach((t) => {
      const kind = t.receiver.track && t.receiver.track.kind;
      try { t.direction = "sendrecv"; } catch (e) {}
      const track = kind === "audio" ? mic : cam;
      if (t.sender) {
        t.sender.replaceTrack(track || null).catch(() => {});
        if (kind === "video" && track) { try { const pr = t.sender.getParameters(); if (!pr.encodings || !pr.encodings.length) pr.encodings = [{}]; pr.encodings[0].maxBitrate = 450000; t.sender.setParameters(pr).catch(() => {}); } catch (e) {} }
      }
    });
  }
  const attachAll = () => Object.values(peers).forEach((p) => attach(p.pc));

  async function join() {
    if (on || busy || !code) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast("المتصفح مش بيدعم الفيديو. جرّب Chrome.");
    busy = true; renderUI();
    try { await getCam(); } catch (e) { busy = false; renderUI(); return toast("الكاميرا مش شغالة: " + (e && e.name === "NotAllowedError" ? "لازم تسمح للكاميرا من إعدادات المتصفح." : (e && e.message) || "")); }
    busy = false; on = true; dbg("دخلت الفيديو، الكاميرا شغالة");
    try { api.onDisconnect(myRef("vc")).remove(); api.onDisconnect(myRef("cam")).remove(); } catch (e) {}
    setP("vc", Date.now()); setP("cam", true);
    renderUI(); sync();
  }
  async function toggleCam() {
    if (cam) { cam.stop(); cam = null; setP("cam", false); }
    else { try { await getCam(); setP("cam", true); } catch (e) { return toast("الكاميرا مرفوضة."); } }
    attachAll(); renderUI();
  }
  async function toggleMic() {
    if (mic) { mic.stop(); mic = null; }
    else { try { await getMic(); } catch (e) { return toast("المايك مرفوض."); } }
    attachAll(); renderUI();
  }
  function hangup(silent) {
    const was = on; on = false;
    if (cam) { cam.stop(); cam = null; } if (mic) { mic.stop(); mic = null; }
    Object.keys(peers).forEach(closePeer);
    if (was && code && !silent) { try { api.remove(myRef("vc")); api.remove(myRef("cam")); } catch (e) {} }
    bigU = null; renderUI();
  }

  /* ---------------- WebRTC ---------------- */
  function closePeer(u) {
    const p = peers[u]; if (!p) return;
    try { p.pc.close(); } catch (e) {}
    delete peers[u]; removeTile(u);
    try { if (code) api.remove(ref("rtc/" + u + "/" + uid)); } catch (e) {}
  }
  let warned = false;
  const send = (to, sid, type, data) => { if (type !== "ice") dbg("بعت " + type + " ل " + sh(to)); try { api.push(ref("rtc/" + to + "/" + uid), { sid, t: type, d: JSON.stringify(data), n: Date.now() }).catch((e) => { if (!warned) { warned = true; toast("الفيديو محتاج تحديث قواعد Firebase (rtc)."); } console.warn(e); dbg("رفض إرسال " + type + ": " + (e && (e.code || e.message))); }); } catch (e) {} };
  function makePeer(u, sid, offerer) {
    closePeer(u);
    const pc = new RTCPeerConnection(ICE);
    const p = { pc, sid, stream: new MediaStream(), seen: new Set(), queue: [], off: offerer };
    peers[u] = p;
    pc.ontrack = (e) => {
      const tr = e.track; dbg("وصل " + tr.kind + " من " + sh(u));
      tr.onunmute = () => { dbg(tr.kind + " بدأ يوصل من " + sh(u)); renderUI(); playTile(u); };
      tr.onmute = () => renderUI();
      if (!p.stream.getTracks().includes(tr)) p.stream.addTrack(tr);
      if (tr.kind === "video" && tiles[u]) tiles[u]._v.srcObject = p.stream;   // الموبايل (iOS) محتاج إعادة ربط
      renderUI(); playTile(u);
    };
    pc.onicecandidate = (e) => { if (e.candidate) send(u, sid, "ice", e.candidate); };
    pc.oniceconnectionstatechange = () => dbg("ice " + sh(u) + ": " + pc.iceConnectionState); pc.onconnectionstatechange = () => { dbg("conn " + sh(u) + ": " + pc.connectionState); if (pc.connectionState === "failed" && peers[u] === p) { closePeer(u); setTimeout(sync, 1000); } };
    if (offerer) { pc.addTransceiver("audio", { direction: "sendrecv" }); pc.addTransceiver("video", { direction: "sendrecv" }); attach(pc); }
    ensureTile(u); refreshTiles(); return p;
  }
  async function startOffer(u) {
    const sid = String(Date.now()); dbg("ببدأ اتصال مع " + sh(u));
    try { await api.set(ref("rtc/" + u + "/" + uid), null); } catch (e) {}
    const p = makePeer(u, sid, true);
    try { const o = await p.pc.createOffer(); await p.pc.setLocalDescription(o); send(u, sid, "offer", o); } catch (e) { console.error(e); }
  }
  async function onMsg(from, id, m) {
    let p = peers[from];
    if (p && p.seen.has(id)) return;
    if (m.t !== "ice") dbg("استلمت " + m.t + " من " + sh(from));
    if (m.t === "offer") {
      if (!on) return;
      if (!p || p.sid !== m.sid) { if (p && Number(m.sid) < Number(p.sid)) return; p = makePeer(from, m.sid, false); }
      p.seen.add(id);
      try {
        await p.pc.setRemoteDescription(JSON.parse(m.d)); attach(p.pc);
        const a = await p.pc.createAnswer(); await p.pc.setLocalDescription(a); send(from, m.sid, "answer", a);
        p.queue.splice(0).forEach((c) => p.pc.addIceCandidate(c).catch(() => {}));
      } catch (e) { console.error(e); }
      return;
    }
    if (!p || p.sid !== m.sid) return;
    p.seen.add(id);
    try {
      if (m.t === "answer" && p.pc.signalingState === "have-local-offer") {
        await p.pc.setRemoteDescription(JSON.parse(m.d));
        p.queue.splice(0).forEach((c) => p.pc.addIceCandidate(c).catch(() => {}));
      } else if (m.t === "ice") {
        const c = JSON.parse(m.d);
        if (p.pc.remoteDescription) p.pc.addIceCandidate(c).catch(() => {}); else p.queue.push(c);
      }
    } catch (e) { console.error(e); }
  }

  function sync() {
    if (!code) return;
    Object.keys(peers).forEach((u) => { const q = players[u]; if (!on || !q || !q.vc || q.online === false) closePeer(u); });
    if (on) {
      Object.keys(players).forEach((u) => {
        const q = players[u];
        if (u === uid || !q || q.bot || !q.vc || q.online === false || peers[u]) return;
        if (uid < u) startOffer(u);                    // الأصغر هو اللي بيبدأ
      });
    }
    refreshTiles(); renderUI();
  }

  /* ---------------- ربط بالغرفة ---------------- */
  async function attachRoom(c) {
    if (!(await init())) return;
    if (code || roomCode() !== c) return;
    code = c; buildDock();
    unsubs.push(api.onValue(ref("public/players"), (snap) => {
      players = snap.val() || {};
      if (!players[uid] && on) hangup(true);
      sync();
    }, (e) => dbg("رفض قراءة players: " + (e && e.code))));
    unsubs.push(api.onValue(api.ref(db, "rooms/" + code + "/rtc/" + uid), (snap) => {
      const v = snap.val() || {};
      Object.keys(v).sort().forEach((from) => { const msgs = v[from] || {}; Object.keys(msgs).sort().forEach((id) => onMsg(from, id, msgs[id])); });
    }, (e) => dbg("رفض قراءة rtc: " + (e && e.code))));
  }
  function detachRoom() {
    hangup(true);
    unsubs.forEach((u) => { try { u(); } catch (e) {} }); unsubs = [];
    code = null; players = {}; bigU = null;
    Object.keys(tiles).forEach((k) => delete tiles[k]);
    if (dock) { dock.remove(); dock = null; } if (fab) { fab.remove(); fab = null; }
  }
  setInterval(() => {
    const c = roomCode();
    if (c && !code) attachRoom(c);
    else if (code && c !== code) detachRoom();
  }, 800);
  setInterval(drawDbg, 1000);
  const toggle = () => (on ? hangup() : join());
  window.MEMA_VCALL = { join, hangup, toggle, paint, status: () => ({ on, peers: Object.keys(peers), code }) };
})();
