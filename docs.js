// ===== 文字偵測（PP-OCRv5 det）+ 各類證件欄位解析 =====
let detSess = null;
let detLoading = null;
function loadDet() { return detLoading || (detLoading = (async () => {
  await loadModel();
  const buf = await getAsset('model/ppocr_v5_mobile_det.onnx', '偵測模型');
  detSess = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
})().catch(e => { detLoading = null; throw e; })); }

// 找出圖上所有文字列的位置（DB 後處理：二值化 → 連通區塊 → 外擴）
async function detectLines(img, limit = 960) {
  const W = img.width, H = img.height, s = Math.min(limit / Math.max(W, H), 4);
  const w = Math.max(32, Math.round(W*s/32)*32), h = Math.max(32, Math.round(H*s/32)*32);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data, n = w*h, f = new Float32Array(3*n);
  const mean = [0.485,0.456,0.406], std = [0.229,0.224,0.225];
  for (let i = 0; i < n; i++) {           // 依 PaddleOCR 慣例用 BGR 順序
    f[i]     = (px[i*4+2]/255 - mean[0]) / std[0];
    f[n+i]   = (px[i*4+1]/255 - mean[1]) / std[1];
    f[2*n+i] = (px[i*4]  /255 - mean[2]) / std[2];
  }
  const out = await detSess.run({ [detSess.inputNames[0]]: new ort.Tensor('float32', f, [1,3,h,w]) });
  const p = out[detSess.outputNames[0]].data;
  const seen = new Uint8Array(n), boxes = [], q = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (p[i] <= 0.3 || seen[i]) continue;
    let head = 0, tail = 0, x0 = w, x1 = 0, y0 = h, y1 = 0, cnt = 0, sc = 0;
    q[tail++] = i; seen[i] = 1;
    while (head < tail) {
      const k = q[head++], y = (k / w) | 0, x = k - y*w;
      cnt++; sc += p[k];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const nb = [x > 0 ? k-1 : -1, x < w-1 ? k+1 : -1, y > 0 ? k-w : -1, y < h-1 ? k+w : -1];
      for (const m of nb) if (m >= 0 && !seen[m] && p[m] > 0.3) { seen[m] = 1; q[tail++] = m; }
    }
    const bw = x1-x0+1, bh = y1-y0+1;
    if (Math.min(bw, bh) < 3 || sc/cnt < 0.5) continue;
    const d = bw*bh*1.6 / (2*(bw+bh));
    boxes.push({ x0: Math.max(0,(x0-d)/w), y0: Math.max(0,(y0-d)/h), x1: Math.min(1,(x1+1+d)/w), y1: Math.min(1,(y1+1+d)/h) });
  }
  return boxes;
}

async function readAllLines(img, onProgress) {
  const boxes = (await detectLines(img)).filter(b => (b.x1-b.x0)*img.width >= (b.y1-b.y0)*img.height*0.8);
  const lines = [];
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (onProgress) onProgress(i+1, boxes.length);
    const t = await recRegion(img, b.x0, b.y0, b.x1, b.y1);
    if (t) lines.push({ ...b, t, cx: (b.x0+b.x1)/2, cy: (b.y0+b.y1)/2 });
  }
  lines.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  return lines;
}

// ---------- 共用小工具 ----------
const CJK = /^[一-鿿]{2,5}$/;
const pad2 = s => String(s).padStart(2, '0');
const fixDigits = s => s.replace(/[OoQD]/g,'0').replace(/[Il|]/g,'1').replace(/S/g,'5').replace(/B/g,'8');
function findIds(lines) {                     // 身分證 / 居留證 / 統一證號（含檢查碼）
  const found = [];
  for (const L of lines) {
    const t = L.t.toUpperCase().replace(/[^A-Z0-9]/g, '');
    for (const m of t.matchAll(/[A-Z][A-D0-9IOLSB][0-9OIQDSB]{8}/g)) {
      const s = m[0][0] + (/[A-D]/.test(m[0][1]) ? m[0][1] : fixDigits(m[0][1])) + fixDigits(m[0].slice(2));
      if (validId(s)) found.push({ v: s, L });
    }
  }
  return found;
}
const LABELS = /^(姓名|NAME|出生日期|出生地|性别|性別|身分證號碼|住址|備註|發照日期|有效日期|國籍|男|女|台灣|臺灣|越南|印尼|菲律賓|泰國|外僑居留證|中華民國居留證|居留證)$/;
const EN_STOP = /^(ARC|NAME|BIRTHDAY|BIRTHPLACE|SEX|ADDRESS|REMARKS|PERMIT|MULTIPLE|RE-ENTRY|MULTIPLERE-ENTRY|MALE|FEMALE|M|F|TAIWAN|TAIPEI|NATIONAL|HEALTH|INSURANCE|NATIONALHEALTHINSURANCE|PASSPORT|REPUBLIC|CHINA|ROC|R\.O\.C\.)$/;
const isEnName = t => /^[A-Z][A-Z .,'-]*[A-Z]$/.test(t) && !EN_STOP.test(t.replace(/\s/g,'')) && !/[0-9]/.test(t);
const NATS = ['越南','印尼','菲律賓','泰國','緬甸','馬來西亞','柬埔寨','斯里蘭卡','孟加拉','印度','日本','韓國','美國','中國大陸','俄羅斯','烏克蘭','英國','法國','德國','加拿大','澳大利亞','澳洲','紐西蘭','新加坡','香港','澳門','蒙古','尼泊爾','巴基斯坦','南非','巴西','墨西哥','義大利','西班牙','荷蘭','土耳其','寮國','汶萊','東帝汶','吉里巴斯','吐瓦魯','斐濟','索羅門群島','巴拿馬','祕魯','智利','阿根廷'];
const MONTHS = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };

// ---------- 居留證 ----------
function parseArc(lines) {
  const r = {};
  const ids = findIds(lines); if (ids.length) { r.idno = ids[0].v; }
  const dates = [];
  for (const L of lines) for (const m of L.t.matchAll(/((?:19|20)\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})/g))
    dates.push(`${m[1]}-${pad2(m[2])}-${pad2(m[3])}`);
  dates.sort(); if (dates.length) r.birth = dates[0];          // 生日一定最早（早於核發日、到期日）
  // 護照號碼：先找「護照號碼 Passport No.」標籤正下方那一行（有些國家全是數字，例如俄羅斯 759411029）
  const pl = lines.find(L => /PASSPORT|護照|照號|號碼/i.test(L.t) && !/\d{5}/.test(L.t));
  const norm = L => L.t.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const okNo = t => /^[A-Z0-9]{6,10}$/.test(t) && /\d{5}/.test(t) && t !== r.idno && !/^(19|20)\d{6}$/.test(t);
  if (pl) {
    const below = lines.filter(L => L !== pl && L.cy > pl.cy && L.cy < pl.cy + 0.12 && L.x1 > pl.x0 - 0.05 && L.x0 < pl.x1 + 0.1 && okNo(norm(L)))
      .sort((a, b) => a.cy - b.cy);
    if (below.length) r.ppno = norm(below[0]);
  }
  if (!r.ppno) for (const L of lines) {
    const t = norm(L);
    if (/^[A-Z]{1,2}\d{6,8}$/.test(t) && t !== r.idno) { r.ppno = t; break; }
  }
  // 國籍：已知國名，或「國籍 Nationality」下方的中文，或三碼國家代號（例如 RUS）
  r.nat = NATS.find(n => lines.some(L => L.t.includes(n))) || '';
  if (!r.nat) {
    const nl = lines.find(L => /國籍|國箱|國藉|NATIONAL/i.test(L.t) && !/REPUBLIC/i.test(L.t));
    if (nl) {
      const c = lines.filter(L => L !== nl && L.cy > nl.cy - 0.02 && L.cy < nl.cy + 0.1 && L.x1 > nl.x0 - 0.05 && L.x0 < nl.x1 + 0.15)
        .find(L => /^[\u4e00-\u9fff]{2,5}$/.test(L.t) || /^[A-Z]{3}$/.test(L.t.trim()) && L.t.trim() !== 'ARC');
      if (c) r.nat = c.t.trim();
    }
  }
  // 英文姓名：統一證號下方、出生日期上方，左半邊的大寫英文
  const idL = ids[0]?.L, birthLbl = lines.find(L => /出生日期|Date.?of.?b/i.test(L.t));
  const top = idL ? idL.cy : 0, bottom = birthLbl ? birthLbl.cy : (idL ? idL.cy + 0.25 : 1);
  const en = lines.filter(L => L.cy > top && L.cy < bottom && L.x0 < 0.5 && isEnName(L.t.toUpperCase()));
  r.nameEn = en.sort((a,b) => a.x0 - b.x0).map(L => L.t.toUpperCase()).join(' ').replace(/\s+/g,' ').trim();
  const zh = lines.filter(L => L.cy > top - 0.03 && L.cy < bottom && CJK.test(L.t) && !LABELS.test(L.t) && !/姓名|日期|居留|服務站/.test(L.t));
  r.name = zh.length ? zh[0].t : '';
  return r;
}

// ---------- 駕照 ----------
function parseDl(lines) {
  const r = {};
  const ids = findIds(lines); if (ids.length) r.idno = ids[0].v;
  // 日期格式 055.07.11；出生、有效、發照三個日期裡年份最小的是生日
  const ds = [];
  for (const L of lines) {
    const t = L.t.replace(/\s/g, '');
    let m = t.match(/^0?(\d{2,3})[.\/](\d{1,2})[.\/](\d{1,2})$/) || t.match(/^0?(\d{2,3})(\d{2})(\d{2})$/);
    if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) ds.push([+m[1], m[2], m[3], L]);
  }
  ds.sort((a, b) => a[0] - b[0]);
  if (ds.length) r.birth = `${ds[0][0]}/${pad2(ds[0][1])}/${pad2(ds[0][2])}`;
  // 姓名：駕照號碼那一列和出生日期那一列之間的中文
  const top = ids[0]?.L.cy ?? 0, bottom = ds.length ? ds[0][3].cy : 1;
  const zh = lines.filter(L => L.cy > top && L.cy < bottom && /^[一-鿿]{2,5}$/.test(L.t)
    && !/駕|照|號碼|姓名|性別|性别|出生|日期|條件|持照|機車|汽車|交通|種類|中華民國/.test(L.t)).sort((a, b) => a.cy - b.cy);
  if (zh.length) r.name = zh[0].t;
  const all = lines.map(L => L.t).join(' ');
  r.sex = /性.?女|女$/.test(all) ? '女' : /性.?男/.test(all) ? '男' : '';
  return r;
}

// ---------- 健保卡 ----------
function parseNhi(lines) {
  const r = {};
  const ids = findIds(lines); if (ids.length) r.idno = ids[0].v;
  for (const L of lines) {
    const m = L.t.match(/^(\d{2,3})[\/.](\d{2})[\/.](\d{2})$/);
    if (m) { r.birth = `${+m[1]}/${m[2]}/${m[3]}`; break; }
  }
  const idL = ids[0]?.L;
  const cand = lines.filter(L => (!idL || L.cy < idL.cy) && L.cy > 0.2 && (isEnName(L.t.toUpperCase()) || (CJK.test(L.t) && !/健康|保險|保险/.test(L.t))));
  const pick = cand.sort((a,b) => b.cy - a.cy)[0];
  if (pick) { if (CJK.test(pick.t)) r.name = pick.t; else r.nameEn = pick.t.toUpperCase(); }
  return r;
}

// ---------- 船員服務手冊（只取中文姓名）----------
async function parseSeaman(lines, img) {
  const r = {};
  const ids = findIds(lines); if (ids.length) r.idno = ids[0].v;
  // 生日在表格最上面一列日期：照閱讀順序取第一個合理的民國日期
  for (const L of lines) {
    const m = L.t.replace(/\s/g,'').match(/(\d{2,3})年(\d{1,2})月(\d{1,2})日?/);
    if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) { r.birth = `${+m[1]}/${pad2(m[2])}/${pad2(m[3])}`; break; }
  }
  for (const L of lines) { const m = L.t.toUpperCase().match(/([A-Z]{3}\d{6})/); if (m) { r.docno = m[1]; break; } }
  const bl = lines.find(L => /出生日期|BIRTH/i.test(L.t)), lim = bl ? bl.cy : 0.4;
  const votes = {};
  const vote = s => { s = (s || '').replace(/[^\u4e00-\u9fff]/g, ''); if (s.length >= 2 && s.length <= 4 && !LABELS.test(s) && !/日期|姓名|出生|住址|身分|號碼|有效|發照/.test(s)) votes[s] = (votes[s] || 0) + 1; };
  // 1) 偵測到的中文框
  lines.filter(L => L.cy < lim && CJK.test(L.t)).forEach(L => vote(L.t));
  // 2) 中文姓名印在英文姓名正上方，字很淡時偵測會漏，直接讀那一條
  const en = lines.find(L => L.cy < lim && isEnName(L.t.toUpperCase()));
  if (en && img) {
    const h = en.y1 - en.y0, w = en.x1 - en.x0;
    for (const dy of [0, 0.15, -0.15]) for (const k of [1.2, 1.5]) {
      vote(await recRegion(img, en.x0 - w*0.25, en.y0 - h*(k+dy), en.x1 + w*0.25, en.y0 + h*0.15 - h*dy));
    }
  }
  // 讀到一半的（例如「李承」）算給完整的（「李承翰」）
  const score = c => Object.entries(votes).reduce((n, [k, v]) => n + (c.includes(k) ? v : 0), 0);
  const best = Object.keys(votes).map(k => [k, score(k)]).sort((a,b) => b[1]-a[1] || b[0].length - a[0].length)[0];
  r.name = best ? best[0] : '';
  return r;
}

// ---------- 護照：先讀 MRZ，讀不到再看資料頁上的印刷字 ----------
function parsePassportLines(lines) {
  const r = {};
  const ts = lines.map(L => L.t.toUpperCase().replace(/\s/g,'').replace(/[>«‹]/g,'<'));
  for (const t of ts) { const m2 = parseMrz2(t); if (m2) { r.ppno = m2.doc; r.nat = m2.nat; r.birth = m2.dob;
    const tw = m2.opt.match(/[A-Z][12]\d{8}/); if (tw && validId(tw[0])) r.idno = tw[0]; r.mrz = true; r.sex = m2.sex === 'F' ? '女' : m2.sex === 'M' ? '男' : ''; break; } }
  for (const t of ts) { const u = t.replace(/^P[^A-Z<]/, 'P<'); if (!/^P[A-Z<]/.test(u) || !/<</.test(u)) continue;
    const m1 = parseMrz1(u); if (m1) { r.nameEn = m1.name; break; } }
  const tw = r.nat === 'TWN' || lines.some(L => /REPUBLIC\s*OF\s*CHINA|中華民國/i.test(L.t));
  if (!r.idno && tw) { const ids = findIds(lines.filter(L => !/<</.test(L.t))); if (ids.length) r.idno = ids[0].v; }
  if (!tw && r.idno && !r.mrz) delete r.idno;
  if (tw && !r.nat) r.nat = 'TWN';
  if (!r.ppno) {
    const lbl = lines.find(L => /PASSPORT\s*N|護照號|SOHOCHIEU/i.test(L.t.replace(/\s/g,'')));
    const near = lines.filter(L => /^[A-Z]{0,2}\d{7,9}$/.test(L.t.replace(/\s/g,'').toUpperCase()))
      .sort((a,b) => (lbl ? Math.hypot(a.cx-lbl.cx, a.cy-lbl.cy) - Math.hypot(b.cx-lbl.cx, b.cy-lbl.cy) : 0));
    if (near.length) r.ppno = near[0].t.replace(/\s/g,'').toUpperCase();
  }
  if (!r.birth) {
    const ds = [];
    for (const L of lines) {
      let m = L.t.toUpperCase().match(/(\d{1,2})\s*([A-Z]{3})\s*((?:19|20)\d{2})/);
      if (m && MONTHS[m[2]]) ds.push(`${m[3]}-${pad2(MONTHS[m[2]])}-${pad2(m[1])}`);
      m = L.t.match(/(\d{2})[\/.](\d{2})[\/.]((?:19|20)\d{2})/);
      if (m) ds.push(`${m[3]}-${m[2]}-${m[1]}`);
    }
    ds.sort(); if (ds.length) r.birth = ds[0];
  }
  // 資料頁「姓名/Name」下一列：中文姓名 + 英文姓名（可能被切成好幾段）
  const lbl = lines.find(L => /NAME/i.test(L.t) && !/</.test(L.t));
  if (lbl) {
    const first = lines.find(L => L !== lbl && L.cy > lbl.cy + 0.005 && L.cy < lbl.cy + 0.12);
    if (first) {
      const hgt = first.y1 - first.y0;
      const row = lines.filter(L => Math.abs(L.cy - first.cy) < hgt * 0.6 && !/\/|NATIONALITY|SURNAME|GIVEN|PERSONAL|國籍/i.test(L.t)).sort((a,b) => a.x0 - b.x0);
      const txt = row.map(L => L.t).join(' ');
      const zh = txt.match(/[一-鿿]{2,4}/); if (zh && !r.name) r.name = zh[0];
      const en = txt.replace(/[一-鿿]/g, '').toUpperCase().replace(/[^A-Z ,-]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!r.nameEn && en.length >= 2) r.nameEn = en.replace(/\s*,\s*/, ', ');
    }
  }
  return r;
}
