// ===== 辨識樣本：自動保存每次辨識用的證件畫面＋結果＋辨識原文，之後匯出 ZIP 給開發者調整 =====
const SAMPLE_DB = 'idscan-samples', SAMPLE_MAX = 80;
function sdb() {
  return new Promise((ok, no) => {
    const r = indexedDB.open(SAMPLE_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('s', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
}
async function sampleTx(mode, fn) {
  const db = await sdb();
  return new Promise((ok, no) => { const t = db.transaction('s', mode); const st = t.objectStore('s'); const res = fn(st); t.oncomplete = () => ok(res && res.result !== undefined ? res.result : res); t.onerror = () => no(t.error); });
}
const samplesOn = () => { try { return localStorage.getItem('idscan_samples_on') !== '0'; } catch { return true; } };

async function saveSample(card, log, fields) {
  if (!samplesOn()) return;
  try {
    const blob = await new Promise(r => card.toBlob(r, 'image/jpeg', 0.92));
    await sampleTx('readwrite', st => st.add({ t: new Date().toISOString(), type: docType, img: blob, log, fields }));
    // 只留最近 SAMPLE_MAX 張
    const keys = await sampleTx('readonly', st => st.getAllKeys());
    if (keys.length > SAMPLE_MAX) await sampleTx('readwrite', st => keys.slice(0, keys.length - SAMPLE_MAX).forEach(k => st.delete(k)));
    renderSamples();
  } catch (e) { console.log('sample', e); }
}
async function renderSamples() {
  try { const n = (await sampleTx('readonly', st => st.count())); $('sampleCount').textContent = n; } catch { $('sampleCount').textContent = '?'; }
  $('sampleOn').checked = samplesOn();
}
async function clearSamples() {
  if (!confirm('刪除所有辨識樣本照片？')) return;
  await sampleTx('readwrite', st => st.clear()); renderSamples();
}

// --- 最小的 ZIP 產生器（不壓縮）---
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC_T[(c ^ u[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function makeZip(files) {   // files: [{ name, data: Uint8Array }]
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true); h.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(h.buffer), nm, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + sz;
  }
  const cs = central.reduce((s, u) => s + u.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cs, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
async function exportSamples() {
  const all = await sampleTx('readonly', st => st.getAll());
  if (!all.length) { alert('還沒有樣本'); return; }
  const files = [], enc = new TextEncoder(); let report = '';
  for (const s of all) {
    const dt = new Date(s.t), q = n => String(n).padStart(2, '0');
    const base = `${String(s.id).padStart(4, '0')}_${dt.getFullYear()}${q(dt.getMonth()+1)}${q(dt.getDate())}_${q(dt.getHours())}${q(dt.getMinutes())}${q(dt.getSeconds())}_${s.type}`;
    files.push({ name: base + '.jpg', data: new Uint8Array(await s.img.arrayBuffer()) });
    report += `=== ${base}\n結果: ${JSON.stringify(s.fields)}\n${(s.log || []).join('\n')}\n\n`;
  }
  files.push({ name: 'ocr_log.txt', data: enc.encode(report) });
  const d = new Date(), p = n => String(n).padStart(2, '0');
  shareFile(makeZip(files), `samples_${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.zip`, 'application/zip');
}
