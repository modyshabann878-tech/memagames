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
  let unsubs = [], dock = null;

  const el = (t, css, html) => { const e = document.createElement(t); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; };
  const ref = (p) => api.ref(db, "rooms/" + code + "/" + p);
  const toast = (t) => {
    const d = el("div", "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#0f172a;color:#f8fafc;border:2px solid #38bdf8;padding:10px 16px;border-radius:12px;z-index:9999;max-width:90vw;text-align:center", "");
    d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3200);
  };

  /* ---------------- تجهيز Firebase ---------------- */
  async function init() {
    if (api) return true;
    try {
      const fb = await window.MEMA_FB_READY; if (!fb) return false;
      const a = window.MEMA_DB_API || (await import(FBV + "firebase-database.js"));
      db = a.getDatabase(fb.app, DB_URL);
      if (fb.auth.authStateReady) await fb.auth.authStateReady();
      uid = fb.auth.currentUser && fb.auth.currentUser.uid;
      if (!uid) return false;
      api = a; return true;
    } catch (e) { console.warn("call init", e); return false; }
  }
  function roomCode() {
    try { const s = JSON.parse(sessionStorage.getItem("mema_room") || "null"); return s && s.code ? String(s.code) : null; } catch (e) { return null; }
  }

  /* ---------------- واجهة (نافذة زي مكالمة ماسنجر) ---------------- */
  const loadPos = () => { try { return JSON.parse(localStorage.getItem(POS_KEY)) || null; } catch (e) { return null; } };
  const savePos = (x, y) => { try { localStorage.setItem(POS_KEY, JSON.stringify({ x, y })); } catch (e) {} };
  let big = false, hidden = false, saved = null;

  function buildDock() {
    if (dock) return;
    dock = el("div", "position:fixed;z-index:9500;top:78px;left:8px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;touch-action:none;direction:rtl;font-family:inherit");
    const p = loadPos(); if (p) { dock.style.left = Math.max(0, Math.min(p.x, innerWidth - 60)) + "px"; dock.style.top = Math.max(0, Math.min(p.y, innerHeight - 60)) + "px"; }
    dock.innerHTML =
      '<button id="vc-fab" aria-label="مكالمة فيديو" style="width:52px;height:52px;border-radius:50%;border:2px solid #38bdf8;background:#0f172a;color:#fff;font-size:24px;box-shadow:0 4px 14px #0008;cursor:grab;touch-action:none">📹</button>' +
      '<div id="vc-win" style="display:none;position:relative;background:#0b1224;border:2px solid #38bdf8;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px #000a;touch-action:none;cursor:grab">' +
        '<div id="vc-remote" style="position:absolute;inset:0;display:flex;flex-wrap:wrap"></div>' +
        '<div id="vc-wait" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:#94a3b8;font-size:13px;padding:10px;line-height:1.6">في انتظار حد يدخل المكالمة…</div>' +
        '<div style="position:absolute;bottom:6px;left:6px;width:38px;height:50px;border-radius:8px;overflow:hidden;border:2px solid #fff;background:#111;z-index:2">' +
          '<video id="vc-self" autoplay muted playsinline style="width:100%;height:100%;object-fit:cover;transform:scaleX(-1)"></video>' +
          '<div id="vc-selfoff" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:#111;font-size:16px">📷</div></div>' +
        '<div id="vc-ctl" style="position:absolute;bottom:6px;right:6px;left:56px;display:none;gap:6px;justify-content:flex-end;z-index:3"></div>' +
      '</div>';
    document.body.appendChild(dock);
    wireDrag(dock.querySelector("#vc-fab"), "fab");
    wireDrag(dock.querySelector("#vc-win"), "win");
    renderUI();
  }

  function wireDrag(node, kind) {
    let sx, sy, ox, oy, moved = false, act = false;
    node.addEventListener("pointerdown", (e) => {
      if (kind === "win" && e.target.closest("button")) return;
      act = true; moved = false; sx = e.clientX; sy = e.clientY;
      const r = dock.getBoundingClientRect(); ox = r.left; oy = r.top;
      try { node.setPointerCapture(e.pointerId); } catch (x) {}
    });
    node.addEventListener("pointermove", (e) => {
      if (!act) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      dock.style.left = Math.min(Math.max(0, ox + dx), innerWidth - 56) + "px";
      dock.style.top = Math.min(Math.max(0, oy + dy), innerHeight - 56) + "px";
    });
    node.addEventListener("pointerup", () => {
      if (!act) return; act = false;
      if (moved) { if (!big) { const r = dock.getBoundingClientRect(); savePos(Math.round(r.left), Math.round(r.top)); } return; }
      if (kind === "fab") { if (!on) join(); else { hidden = !hidden; renderUI(); } }
      else setBig(!big);
    });
    node.addEventListener("pointercancel", () => { act = false; });
  }

  function setBig(v) {
    big = v;
    if (big) { saved = { l: dock.style.left, t: dock.style.top }; }
    renderUI();
    if (big) { const w = dock.querySelector("#vc-win").offsetWidth; dock.style.left = Math.max(4, (innerWidth - w) / 2) + "px"; dock.style.top = "60px"; }
    else if (saved) { dock.style.left = saved.l; dock.style.top = saved.t; }
  }

  function cbtn(label, fn, bg) {
    const b = el("button", "width:38px;height:38px;border-radius:50%;border:0;background:" + (bg || "#1e293bcc") + ";color:#fff;font-size:17px;cursor:pointer", label);
    b.onclick = (e) => { e.stopPropagation(); fn(); }; return b;
  }
  function renderUI() {
    if (!dock) return;
    const fab = dock.querySelector("#vc-fab"), win = dock.querySelector("#vc-win"), ctl = dock.querySelector("#vc-ctl");
    fab.style.background = on ? "#16a34a" : "#0f172a";
    fab.textContent = busy ? "⏳" : "📹";
    win.style.display = on && !hidden ? "block" : "none";
    win.style.width = big ? Math.min(innerWidth - 16, 420) + "px" : "122px";
    win.style.height = big ? Math.min(Math.round(innerHeight * 0.7), 560) + "px" : "164px";
    ctl.style.display = big ? "flex" : "none"; ctl.innerHTML = "";
    if (big) ctl.append(cbtn(cam ? "📷" : "🚫", toggleCam), cbtn(mic ? "🎤" : "🔇", toggleMic), cbtn("✖", () => hangup(), "#b91c1c"));
    else if (on) { /* مصغّرة: اضغط عليها عشان تكبر */ }
    const self = dock.querySelector("#vc-self");
    if (cam && self.srcObject !== selfStream()) { self.srcObject = selfStream(); self.play().catch(() => {}); }
    dock.querySelector("#vc-selfoff").style.display = cam ? "none" : "flex";
    dock.querySelector("#vc-wait").style.display = Object.keys(peers).length ? "none" : "flex";
  }
  let _ss = null;
  function selfStream() { if (!_ss || _ss.getVideoTracks()[0] !== cam) _ss = cam ? new MediaStream([cam]) : null; return _ss; }

  function ensureTile(u) {
    const holder = dock.querySelector("#vc-remote");
    let t = holder.querySelector('[data-uid="' + u + '"]');
    if (t) return t;
    t = el("div", "position:relative;flex:1 1 100%;min-height:0;background:#000;overflow:hidden");
    t.dataset.uid = u;
    const v = el("video"); v.autoplay = true; v.playsInline = true; v.style.cssText = "width:100%;height:100%;object-fit:cover";
    const av = el("div", "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:34px;background:#0f172a", "📷");
    const nm = el("div", "position:absolute;top:0;left:0;right:0;background:#0009;color:#fff;font-size:11px;text-align:center;padding:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis");
    t.append(v, av, nm); holder.appendChild(t); t._v = v; t._av = av; t._nm = nm; return t;
  }
  function removeTile(u) { const t = dock && dock.querySelector('[data-uid="' + u + '"]'); if (t) t.remove(); }
  function refreshTiles() {
    if (!dock) return;
    const keys = Object.keys(peers);
    keys.forEach((u) => {
      const t = ensureTile(u), p = players[u] || {}, pr = peers[u];
      t._nm.textContent = p.name || "لاعب";
      t.style.flex = keys.length > 1 ? "1 1 48%" : "1 1 100%";
      if (t._v.srcObject !== pr.stream) { t._v.srcObject = pr.stream; t._v.play().catch(() => {}); }
      t._av.style.display = p.cam ? "none" : "flex";
    });
    dock.querySelector("#vc-wait").style.display = keys.length ? "none" : "flex";
  }

  /* ---------------- ميديا ---------------- */
  const myRef = (k) => ref("public/players/" + uid + "/" + k);
  const setP = (k, v) => { try { api.set(myRef(k), v); } catch (e) {} };
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
    try { await getCam(); } catch (e) { busy = false; renderUI(); return toast("لازم تسمح للكاميرا من إعدادات المتصفح."); }
    busy = false; on = true; hidden = false;
    try { api.onDisconnect(myRef("vc")).remove(); api.onDisconnect(myRef("cam")).remove(); } catch (e) {}
    setP("vc", Date.now()); setP("cam", true);
    hidden = false; big = false; renderUI(); sync();
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
    big = false; renderUI();
  }

  /* ---------------- WebRTC ---------------- */
  function closePeer(u) {
    const p = peers[u]; if (!p) return;
    try { p.pc.close(); } catch (e) {}
    delete peers[u]; removeTile(u);
    try { if (code) api.remove(ref("rtc/" + u + "/" + uid)); } catch (e) {}
  }
  const send = (to, sid, type, data) => { try { api.push(ref("rtc/" + to + "/" + uid), { sid, t: type, d: JSON.stringify(data), n: Date.now() }); } catch (e) {} };
  function makePeer(u, sid, offerer) {
    closePeer(u);
    const pc = new RTCPeerConnection(ICE);
    const p = { pc, sid, stream: new MediaStream(), seen: new Set(), queue: [], off: offerer };
    peers[u] = p;
    pc.ontrack = (e) => { if (!p.stream.getTracks().includes(e.track)) p.stream.addTrack(e.track); refreshTiles(); const t = dock && dock.querySelector('[data-uid="' + u + '"]'); if (t) t._v.play().catch(() => {}); };
    pc.onicecandidate = (e) => { if (e.candidate) send(u, sid, "ice", e.candidate); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" && peers[u] === p) { closePeer(u); setTimeout(sync, 1000); } };
    if (offerer) { pc.addTransceiver("audio", { direction: "sendrecv" }); pc.addTransceiver("video", { direction: "sendrecv" }); attach(pc); }
    ensureTile(u); refreshTiles(); return p;
  }
  async function startOffer(u) {
    const sid = String(Date.now());
    try { await api.set(ref("rtc/" + u + "/" + uid), null); } catch (e) {}
    const p = makePeer(u, sid, true);
    try { const o = await p.pc.createOffer(); await p.pc.setLocalDescription(o); send(u, sid, "offer", o); } catch (e) { console.error(e); }
  }
  async function onMsg(from, id, m) {
    let p = peers[from];
    if (p && p.seen.has(id)) return;
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
    }));
    unsubs.push(api.onValue(api.ref(db, "rooms/" + code + "/rtc/" + uid), (snap) => {
      const v = snap.val() || {};
      Object.keys(v).sort().forEach((from) => { const msgs = v[from] || {}; Object.keys(msgs).sort().forEach((id) => onMsg(from, id, msgs[id])); });
    }));
  }
  function detachRoom() {
    hangup(true);
    unsubs.forEach((u) => { try { u(); } catch (e) {} }); unsubs = [];
    code = null; players = {}; big = false;
    if (dock) { dock.remove(); dock = null; }
  }
  setInterval(() => {
    const c = roomCode();
    if (c && !code) attachRoom(c);
    else if (code && c !== code) detachRoom();
  }, 800);
  window.MEMA_VCALL = { join, hangup, status: () => ({ on, peers: Object.keys(peers), code }) };
})();
