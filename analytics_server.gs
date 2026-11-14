// Mema Games — سيرفر التحليلات (Google Apps Script)
// 1) غيّر READ_KEY لمفتاح سري خاص بيك. 2) Deploy كـ Web app (Execute as: Me, Access: Anyone).
const READ_KEY = 'غيّر-المفتاح-ده';
const SHEET_NAME = 'events';

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); sh.appendRow(['ts','did','ev','game','chId','chName','n','d','h']); }
  return sh;
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    sheet_().appendRow([new Date(), d.did || '', d.ev || '', d.game || '', d.chId || '', d.chName || '', d.n || 0, d.d || '', d.h === undefined ? '' : d.h]);
  } catch (err) {}
  return ContentService.createTextOutput('ok');
}

function doGet(e) {
  const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  if (!e.parameter || e.parameter.action !== 'summary' || e.parameter.key !== READ_KEY) return out({ error: 'unauthorized' });
  const rows = sheet_().getDataRange().getValues().slice(1);
  const tz = 'Africa/Cairo', fmt = d => Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  const today = fmt(new Date()), week = []; for (let i = 0; i < 7; i++) week.push(fmt(new Date(Date.now() - i * 864e5)));
  const s = { opens: 0, unique: 0, opens_today: 0, opens_7d: 0, hours: Array(24).fill(0), days: {}, gameOpens: {}, gameStarts: {}, players: {}, answers: 0 };
  const dids = {}, ch = {};
  rows.forEach(r => {
    const [ts, did, ev, game, chId, chName, n, d, h] = r;
    dids[did] = 1;
    if (ev === 'open') { s.opens++; s.days[d] = (s.days[d] || 0) + 1; if (h !== '') s.hours[h]++; if (d === today) s.opens_today++; if (week.indexOf(d) >= 0) s.opens_7d++; }
    else if (ev === 'game') s.gameOpens[game] = (s.gameOpens[game] || 0) + 1;
    else if (ev === 'start' || ev === 'answer') {
      const k = game + '|' + chId; const c = ch[k] = ch[k] || { game: game, id: chId, name: chName, starts: 0, questions: 0 };
      if (ev === 'start') { c.starts++; s.gameStarts[game] = (s.gameStarts[game] || 0) + 1; s.players[n] = (s.players[n] || 0) + 1; }
      else { c.questions++; s.answers++; }
    }
  });
  s.unique = Object.keys(dids).length; s.challenges = Object.values(ch);
  return out(s);
}
