// ===== 每筆資料附的證件照片（只存在這支手機的 IndexedDB）＋ 逐筆核對畫面 =====
function cdb() {
  return new Promise((ok, no) => {
    const r = indexedDB.open('idscan-crops', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('c');
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
}
async function cropOp(mode, fn) {
  const db = await cdb();
  return new Promise((ok, no) => { const t = db.transaction('c', mode); const req = fn(t.objectStore('c')); t.oncomplete = () => ok(req && req.result); t.onerror = () => no(t.error); });
}
const putCrop = (rid, blob) => cropOp('readwrite', st => st.put(blob, rid)).catch(() => {});
const getCrop = rid => cropOp('readonly', st => st.get(rid)).catch(() => null);
const delCrop = rid => cropOp('readwrite', st => st.delete(rid)).catch(() => {});
const clearCrops = () => cropOp('readwrite', st => st.clear()).catch(() => {});

// 辨識完：身分證只留下半部（姓名、生日、證號），其他證件留整張；縮到 1000px 寬
let lastCrop = null;
function makeCrop(card, type) {
  const y0 = type === 'id' ? 0.36 : 0, sh = card.height * (1 - y0);
  const W = Math.min(1000, card.width), H = Math.round(W * sh / card.width);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  c.getContext('2d').drawImage(card, 0, card.height * y0, card.width, sh, 0, 0, W, H);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
}

// ---------- 「沒把握」的欄位：表單上標黃色，改過就算確認 ----------
let lastUnsure = [];
function markUnsure(fields) {
  lastUnsure = [...new Set(fields)];
  document.querySelectorAll('[data-f]').forEach(e => e.classList.toggle('unsure', lastUnsure.includes(e.dataset.f)));
}
document.addEventListener('input', e => {
  const w = e.target.closest && e.target.closest('[data-f]');
  if (w && w.classList.contains('unsure')) { w.classList.remove('unsure'); lastUnsure = lastUnsure.filter(f => f !== w.dataset.f); }
});

// ---------- 逐筆核對 ----------
let reviewIdx = -1;
const REV_F = r => {
  const f = TYPES[r.type || 'id'].f, keys = Object.keys(f).filter(k => ['name', 'nameEn', 'birth', 'idno', 'ppno'].includes(k));
  return keys.map(k => [k, f[k].replace(/（.*?）/, '')]);
};
async function openReview(i) {
  const a = load(), r = a[i]; if (!r) return;
  reviewIdx = i;
  const un = r.unsure || [];
  $('rvTitle').textContent = `${TYPES[r.type || 'id'].label}　第 ${i + 1} 筆` + (un.length ? '　⚠ 黃色欄位請核對' : '');
  $('rvFields').innerHTML = REV_F(r).map(([k, lb]) =>
    `<div class="field${un.includes(k) ? ' unsure' : ''}"><label>${esc(lb)}</label><input data-k="${k}" value="${esc(r[k] || '')}" autocomplete="off"></div>`).join('');
  $('rvImg').style.display = 'none'; $('rvNoImg').style.display = 'none';
  $('review').style.display = 'block'; $('review').scrollTop = 0;
  const b = r.rid ? await getCrop(r.rid) : null;
  if (b) { $('rvImg').src = URL.createObjectURL(b); $('rvImg').style.display = 'block'; }
  else $('rvNoImg').style.display = 'block';
}
function closeReview() { $('review').style.display = 'none'; if ($('rvImg').src) URL.revokeObjectURL($('rvImg').src); $('rvImg').src = ''; }
function saveReview(next) {
  const a = load(), r = a[reviewIdx]; if (!r) return closeReview();
  document.querySelectorAll('#rvFields input').forEach(inp => { r[inp.dataset.k] = inp.value.trim(); });
  if (r.idno) r.idno = r.idno.toUpperCase(); if (r.ppno) r.ppno = r.ppno.toUpperCase();
  r.unsure = []; r.checked = true;
  store(a); render(); closeReview();
  if (next) { const j = load().findIndex(x => (x.unsure || []).length); if (j >= 0) openReview(j); else toast('全部核對完成'); }
}
function reviewNextUnsure() { const j = load().findIndex(x => (x.unsure || []).length); if (j >= 0) openReview(j); else toast('沒有需要核對的資料'); }
