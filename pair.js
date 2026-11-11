// ===== 雙機確認：主機（你掃描）⇄ 副機（給客人看）=====
// 資料用 AES-GCM 加密後經 ntfy.sh 轉送；金鑰只存在兩支手機裡（配對 QR code），轉送伺服器看不到內容。
const RELAY = (() => { try { return localStorage.getItem('idscan_relay') || 'https://ntfy.sh'; } catch { return 'https://ntfy.sh'; } })();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/') + '==='.slice((s.length+3)%4)), c => c.charCodeAt(0));
const rand = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };

class Link {
  constructor(pair, role, onMsg, onState) { this.pair = pair; this.role = role; this.onMsg = onMsg; this.onState = onState; this.key = null; this.es = null; this.seen = new Set(); }
  async open() {
    this.key = await crypto.subtle.importKey('raw', unb64u(this.pair.k), 'AES-GCM', false, ['encrypt','decrypt']);
    this.connect();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.connect(); });
  }
  connect() {
    if (this.es && this.es.readyState !== 2) return;
    this.es = new EventSource(`${RELAY}/${this.pair.t}/sse`);
    this.es.onopen = () => this.onState('open');
    this.es.onerror = () => { this.onState('error'); if (this.es.readyState === 2) setTimeout(() => this.connect(), 3000); };
    this.es.onmessage = async e => {
      try {
        const m = JSON.parse(e.data); if (m.event !== 'message' || !m.message) return;
        const raw = unb64u(m.message);
        const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv: raw.slice(0,12) }, this.key, raw.slice(12));
        const msg = JSON.parse(new TextDecoder().decode(plain));
        if (msg.from === this.role || this.seen.has(msg.mid)) return;
        this.seen.add(msg.mid);
        this.onMsg(msg);
      } catch {}
    };
  }
  async send(kind, data) {
    const msg = { from: this.role, mid: rand(8), kind, data, ts: Date.now() };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, this.key, new TextEncoder().encode(JSON.stringify(msg)));
    const body = new Uint8Array(12 + ct.byteLength); body.set(iv); body.set(new Uint8Array(ct), 12);
    const r = await fetch(`${RELAY}/${this.pair.t}`, { method:'POST', body: b64u(body) });
    if (!r.ok) throw new Error('傳送失敗 ' + r.status);
  }
}

// ---------- 客人確認畫面的內容（主機、副機共用）----------
function confirmRowsHtml(rec) {
  const T = TYPES[rec.type] || TYPES.id, rows = [];
  for (const k of Object.keys(T.f)) {
    let v = (rec[k] || '').trim(); if (!v) continue;
    let extra = '';
    if (k === 'birth' && T.date === 'roc') extra = ` <small>(${rocToAd(v).replace('西元 ','')})</small>`;
    if (k === 'idno' || k === 'ppno') v = groupId(v.toUpperCase());
    rows.push(`<div class="cf-row"><div class="k">${esc(T.f[k].replace(/（.*?）/,''))} ${EN_LABEL[k]}</div><div class="v">${esc(v)}${extra}</div></div>`);
  }
  return rows.join('');
}

// ================= 主機端 =================
let opLink = null, dispSeen = 0;
const pending = new Map();
function opState() {
  const el = $('pairState'); if (!el) return;
  const p = lsGet('idscan_pair_op');
  if (!p) { el.innerHTML = '尚未配對副機'; $('pairBtn').textContent = '配對副機（給客人看的手機）'; return; }
  const ago = dispSeen ? Math.round((Date.now() - dispSeen) / 60000) : null;
  el.innerHTML = ago === null ? '已配對，<a href="#" onclick="pingDisplay();return false">測試連線</a>'
    : `<span class="ok">● 副機有回應</span>（${ago < 1 ? '剛剛' : ago + ' 分鐘前'}） <a href="#" onclick="pingDisplay();return false">測試連線</a>`;
  const late = [...pending.values()].filter(r => Date.now() - r.sentAt > 90000);
  if (late.length) el.innerHTML += '<br><span class="bad">副機超過 90 秒沒回應，請看一下副機畫面</span>';
  if (pending.size) el.innerHTML += `<br>等待客人確認：${[...pending.values()].map(r => esc(primaryName(r) || primaryNo(r))).join('、')}`;
  const fix = lsGet('idscan_fix');
  if (fix) el.innerHTML += `<br><a href="#" onclick="fillRecord(lsGet('idscan_fix'));lsSet('idscan_fix',null);opState();return false">⚠ 載入 ${esc(primaryName(fix) || primaryNo(fix))} 的資料來修改</a>`;
  $('pairBtn').textContent = '重新配對副機';
}
async function opStart() {
  const p = lsGet('idscan_pair_op'); if (!p) { opState(); return; }
  opLink = new Link(p, 'op', opOnMsg, () => opState());
  await opLink.open(); opState();
  setInterval(opState, 15000);
}
function opOnMsg(m) {
  if (m.kind === 'hello') { dispSeen = Date.now(); opState(); if ($('pairModal').style.display === 'block') closePairModal(); }
  if (m.kind === 'result') {
    dispSeen = Date.now();
    const rec = pending.get(m.data.id); if (!rec) return;
    pending.delete(m.data.id);
    if (m.data.ok) {
      storeRecord({ ...rec, confirmed:true, confirmedAt:new Date().toISOString() });
      toast(`✓ ${primaryName(rec) || primaryNo(rec)} 已確認並儲存`);
    } else {
      toast(`✗ ${primaryName(rec) || primaryNo(rec)} 說資料有錯，已放回表單請修改`, true);
      if (!hasData(collectRecord())) fillRecord(rec);
      else lsSet('idscan_fix', rec);
    }
    opState();
  }
}
async function pingDisplay() {
  if (!opLink) return;
  $('pairState').textContent = '測試中…';
  const before = dispSeen;
  try { await opLink.send('ping', {}); } catch (e) { $('pairState').innerHTML = '<span class="bad">送不出去：' + esc(e.message) + '</span>'; return; }
  setTimeout(() => { if (dispSeen === before) $('pairState').innerHTML = '<span class="bad">● 副機沒有回應</span>（副機畫面要開著、有網路） <a href="#" onclick="pingDisplay();return false">再試一次</a>'; }, 6000);
}
function isPaired() { return !!(opLink && lsGet('idscan_pair_op')); }
async function sendToDisplay(rec) {
  rec.id = rand(6); rec.sentAt = Date.now();
  pending.set(rec.id, rec);
  try {
    await opLink.send('show', rec);
    clearFields(); $('cardView').style.display = 'none';
    $('status').textContent = '已送到副機，客人確認中…可以先掃下一位。';
  } catch (e) {
    pending.delete(rec.id);
    $('status').textContent = '送不到副機（' + e.message + '），改用這支手機確認。';
    openLocalConfirm(rec);
  }
  opState();
}
function openPairModal() {
  const p = { t: 'idscan-' + rand(18), k: b64u(crypto.getRandomValues(new Uint8Array(32))) };
  lsSet('idscan_pair_op', p);
  const url = `${location.origin}${location.pathname}#display=${p.t}.${p.k}`;
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  $('pairQr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  $('pairModal').style.display = 'block';
  if (opLink) { opLink.es && opLink.es.close(); }
  dispSeen = 0; opStart();
}
function closePairModal() { $('pairModal').style.display = 'none'; }
function unpair() { if (confirm('解除配對？副機需要重新掃 QR code。')) { lsSet('idscan_pair_op', null); opLink && opLink.es && opLink.es.close(); opLink = null; opState(); } }
function toast(msg, bad) {
  const t = $('toast'); t.textContent = msg; t.className = bad ? 'show bad' : 'show';
  clearTimeout(t._h); t._h = setTimeout(() => t.className = '', bad ? 6000 : 3000);
}

// ================= 副機端（客人看的畫面）=================
let dispLink = null, dispCur = null;
function displayMode() {
  const m = location.hash.match(/display=([^.]+)\.([A-Za-z0-9_-]+)/);
  if (m) { lsSet('idscan_pair_disp', { t: m[1], k: m[2] }); history.replaceState(null, '', location.pathname); }
  return lsGet('idscan_pair_disp');
}
async function dispStart(p) {
  document.body.classList.add('disp');
  $('disp').style.display = 'block';
  dispIdle('連線中… Connecting');
  let helloSent = false;   // 免費轉送每天有訊息上限，只在第一次連上時打招呼
  dispLink = new Link(p, 'disp', dispOnMsg, s => {
    if (s === 'open') { if (!helloSent) { helloSent = true; dispLink.send('hello', {}).catch(()=>{}); } if (!dispCur) dispIdle(); }
    else if (!dispCur) dispIdle('網路中斷，重新連線中… Reconnecting');
  });
  await dispLink.open();
  try { navigator.wakeLock && await navigator.wakeLock.request('screen'); } catch {}
  document.addEventListener('visibilitychange', async () => { if (!document.hidden) { try { navigator.wakeLock && await navigator.wakeLock.request('screen'); } catch {} } });
}
function dispIdle(msg) {
  dispCur = null;
  $('dispBody').innerHTML = `<div class="d-idle">${msg ? esc(msg) : '歡迎<br><small>Welcome</small>'}</div>`;
  $('dispBtns').style.display = 'none';
}
function dispOnMsg(m) {
  if (m.kind === 'ping') { dispLink.send('hello', {}).catch(()=>{}); return; }
  if (m.kind === 'show') {
    dispCur = m.data;
    $('dispBody').innerHTML = `<div class="cf-title">請確認您的資料<br><small>Please check your information</small></div>` + confirmRowsHtml(m.data);
    $('dispBtns').style.display = 'flex';
    $('disp').scrollTop = 0;
  }
}
async function dispAnswer(ok) {
  if (!dispCur || dispAnswer.busy) return;
  dispAnswer.busy = true;
  const id = dispCur.id;
  try {
    await dispLink.send('result', { id, ok });
    dispCur = null;
    $('dispBtns').style.display = 'none';
    $('dispBody').innerHTML = `<div class="d-idle">${ok ? '✓ 謝謝！<br><small>Thank you</small>' : '已通知工作人員修改<br><small>Staff will correct it</small>'}</div>`;
    setTimeout(() => { if (!dispCur) dispIdle(); }, 2500);
  } catch { alert('網路不穩，請再按一次 / Network error, please try again'); }
  dispAnswer.busy = false;
}
function dispUnpair() { if (confirm('解除這支副機的配對？')) { lsSet('idscan_pair_disp', null); location.reload(); } }
