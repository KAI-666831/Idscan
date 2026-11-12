// ===== 船員名冊 + 進出港人員名單 =====
const CREW_KEY = 'idscan_crew', SHIP_KEY = 'idscan_ship';
const loadCrew = () => { try { return JSON.parse(localStorage.getItem(CREW_KEY)) || []; } catch { return []; } };
const saveCrew = a => { try { localStorage.setItem(CREW_KEY, JSON.stringify(a)); } catch {} };
const isForeign = r => r.foreign === true || r.type === 'arc' || r.type === 'passport';

// 性別：身分證/統一證號第二碼 1、8 男；2、9 女
function inferSex(r) {
  if (r.sex) return r.sex;
  const id = (r.idno || '').toUpperCase();
  if (/^[A-Z][18]/.test(id)) return '男';
  if (/^[A-Z][29]/.test(id)) return '女';
  return '';
}
// 名單上的寫法：本國人用中文名、民國生日、身分證；外籍用「英文名 中文名」、西元生日、護照號碼
function formName(r) { return isForeign(r) ? [r.nameEn, r.name].filter(Boolean).join(' ') : (r.name || r.nameEn || ''); }
function formId(r)   { return isForeign(r) ? (r.ppno || r.idno || '') : (r.idno || r.ppno || ''); }
function formBirth(r) {
  const b = (r.birth || '').trim();
  let m = b.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (m) {
    if (!isForeign(r)) return [m[1]-1911, +m[2], +m[3]];          // 本國人存成西元的，轉回民國
    return [m[1], +m[2], +m[3]];
  }
  m = b.match(/^(\d{1,3})[\/.](\d{1,2})[\/.](\d{1,2})$/);
  if (m) {
    if (isForeign(r)) return [+m[1]+1911, +m[2], +m[3]];
    return [+m[1], +m[2], +m[3]];
  }
  return ['', '', ''];
}
function crewRole(r) { return r.role || (isForeign(r) ? '船員(外)' : '船員'); }

// ---------- 名冊畫面 ----------
function renderCrew() {
  const a = loadCrew();
  $('crewCount').textContent = a.length;
  $('crewToday').textContent = a.filter(r => r.today).length;
  $('crewList').innerHTML = a.map((r, i) => `
    <label class="crew-row">
      <input type="checkbox" ${r.today ? 'checked' : ''} onchange="crewToggle(${i}, this.checked)">
      <span class="cr-name">${esc(formName(r))}</span>
      <span class="cr-id">${esc(formId(r))}</span>
      <a href="#" onclick="crewDel(${i});return false">刪</a>
    </label>`).join('') || '<div style="color:var(--muted);font-size:14px">名冊是空的。掃描船員證件後按「加入船員名冊」，或匯入名冊檔。</div>';
}
function crewToggle(i, on) { const a = loadCrew(); a[i].today = on; saveCrew(a); renderCrew(); }
function crewAll(on) { const a = loadCrew(); a.forEach(r => r.today = on); saveCrew(a); renderCrew(); }
function crewDel(i) { const a = loadCrew(); if (!confirm(`從名冊刪除 ${formName(a[i])}？`)) return; a.splice(i, 1); saveCrew(a); renderCrew(); }
function addFormToCrew() {
  const r = collectRecord();
  if (!hasData(r)) { alert('表單沒有資料'); return; }
  r.sex = inferSex(r); r.today = true;
  const a = loadCrew();
  const key = formId(r);
  const k = a.findIndex(x => key && formId(x) === key);
  if (k >= 0) a[k] = { ...a[k], ...r }; else a.push(r);
  saveCrew(a); renderCrew();
  clearFields(); $('cardView').style.display = 'none';
  toast(`已加入船員名冊：${formName(r)}`);
}

// 匯入名冊 CSV：類別(本國/外籍), 中文姓名, 英文姓名, 性別, 出生年月日, 證號, 備註
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i+1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i+1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
async function importCrew(file) {
  if (!file) return;
  const rows = parseCsv(await file.text());
  const head = rows.shift() || [];
  const col = name => head.findIndex(h => h.includes(name));
  const ci = { kind: col('類別'), name: col('中文'), en: col('英文'), sex: col('性別'), birth: col('出生'), no: col('證號'), role: col('備註'), today: col('出海') };
  const a = loadCrew(); let n = 0;
  for (const x of rows) {
    const g = k => ci[k] >= 0 ? (x[ci[k]] || '').trim() : '';
    const foreign = /外/.test(g('kind'));
    const r = { type: foreign ? 'passport' : 'id', foreign, name: g('name'), nameEn: g('en').toUpperCase(), sex: g('sex'), birth: g('birth'), role: g('role'), today: /^(是|v|y|1|○|o)$/i.test(g('today')) };
    if (foreign) r.ppno = g('no').toUpperCase(); else r.idno = g('no').toUpperCase();
    if (!r.name && !r.nameEn) continue;
    const k = a.findIndex(y => formId(y) && formId(y) === formId(r));
    if (k >= 0) a[k] = { ...a[k], ...r }; else a.push(r);
    n++;
  }
  saveCrew(a); renderCrew();
  toast(`匯入 ${n} 位船員`);
}

// ---------- 進出港人員名單 ----------
function manifestData() {
  const crew = loadCrew().filter(r => r.today);
  const pax = $('incPax').checked ? load() : [];
  return { title: ($('shipName').value.trim() || '') + '進出港人員名單', crew, pax };
}
function sexCell(s) {
  return `<span class="${s === '男' ? 'circ' : ''}">男</span>&ensp;<span class="${s === '女' ? 'circ' : ''}">女</span>`;
}
function rowHtml(no, r) {
  if (!r) return `<tr><td>${no}</td><td></td><td>${sexCell('')}</td><td class="bd">/&emsp;/&emsp;/</td><td></td><td></td></tr>`;
  const [y, m, d] = formBirth(r), nm = formName(r);
  return `<tr><td>${no}</td><td class="${nm.length > 12 ? 'sm' : ''}">${esc(nm)}</td><td>${sexCell(inferSex(r))}</td>
    <td class="bd">${y}&nbsp;/&nbsp;${m}&nbsp;/&nbsp;${d}</td><td>${esc(formId(r))}</td><td>${esc(r.role !== undefined ? crewRole(r) : '')}</td></tr>`;
}
function openManifest() {
  try { localStorage.setItem(SHIP_KEY, $('shipName').value.trim()); } catch {}
  const { title, crew, pax } = manifestData();
  const paxRows = Math.max(23, pax.length);
  let h = `<div class="mf-title">${esc(title)}</div><table class="mf"><thead><tr><th>編號</th><th>姓名</th><th>性別</th><th>出生&ensp;年&ensp;月&ensp;日</th><th>身分證字號</th><th>備註</th></tr></thead><tbody>`;
  crew.forEach((r, i) => h += rowHtml(i + 1, { ...r, role: crewRole(r) }));
  h += `</tbody><tbody class="pax">`;
  for (let i = 0; i < paxRows; i++) h += rowHtml(i + 1, pax[i] ? { ...pax[i], role: undefined } : null);
  h += `</tbody></table>`;
  $('mfPage').innerHTML = h;
  $('manifest').style.display = 'block'; $('manifest').scrollTop = 0;
}
function closeManifest() { $('manifest').style.display = 'none'; }

// 存成圖片（方便用 LINE 傳或直接列印）
function manifestImage() {
  const { title, crew, pax } = manifestData();
  const rows = [...crew.map((r, i) => [i + 1, { ...r, role: crewRole(r) }, 'crew']),
                ...Array.from({ length: Math.max(23, pax.length) }, (_, i) => [i + 1, pax[i] ? { ...pax[i], role: undefined } : null, 'pax'])];
  const W = 1654, cols = [0.07, 0.22, 0.11, 0.22, 0.24, 0.14], X0 = 90, TW = W - 180, RH = 62, TOP = 200;
  const H = TOP + RH * (rows.length + 1) + 120;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000'; g.strokeStyle = '#000';
  const F = '"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
  g.font = `600 52px ${F}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(title, W / 2, 120);
  const xs = [X0]; cols.forEach(w => xs.push(xs[xs.length - 1] + w * TW));
  const cell = (txt, i, y, size = 34) => {
    g.font = `${size}px ${F}`; let s = size;
    while (g.measureText(txt).width > (xs[i+1] - xs[i]) - 16 && s > 18) { s -= 2; g.font = `${s}px ${F}`; }
    g.fillText(txt, (xs[i] + xs[i+1]) / 2, y + RH / 2);
  };
  const line = (x1, y1, x2, y2, w = 2) => { g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  ['編號', '姓名', '性別', '出生 年 月 日', '身分證字號', '備註'].forEach((t, i) => cell(t, i, TOP));
  rows.forEach(([no, r, kind], k) => {
    const y = TOP + RH * (k + 1);
    cell(String(no), 0, y);
    if (r) {
      cell(formName(r), 1, y);
      const [yy, mm, dd] = formBirth(r); cell(`${yy} / ${mm} / ${dd}`, 3, y);
      cell(formId(r), 4, y); if (r.role !== undefined) cell(crewRole(r), 5, y);
    } else cell('/   /   /', 3, y);
    const sx = r ? inferSex(r) : '';
    const cx = (xs[2] + xs[3]) / 2;
    g.font = `34px ${F}`; g.fillText('男', cx - 30, y + RH / 2); g.fillText('女', cx + 30, y + RH / 2);
    if (sx) { g.lineWidth = 3; g.beginPath(); g.arc(cx + (sx === '男' ? -30 : 30), y + RH / 2, 24, 0, Math.PI * 2); g.stroke(); }
  });
  const yEnd = TOP + RH * (rows.length + 1);
  for (let k = 0; k <= rows.length + 1; k++) {
    const y = TOP + RH * k;
    const thick = k === 0 || k === rows.length + 1 || (k === crew.length + 1 && crew.length);
    line(X0, y, X0 + TW, y, thick ? 4 : 2);
  }
  xs.forEach((x, i) => line(x, TOP, x, yEnd, i === 0 || i === xs.length - 1 ? 4 : 2));
  c.toBlob(b => {
    const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const file = new File([b], `manifest_${stamp}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title }).catch(() => {});
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = file.name; a.click(); }
  }, 'image/png');
}
