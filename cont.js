// ===== 連續掃描：證件放好 → 畫面穩定就自動辨識 → 成功嗶一聲存檔 → 移開換下一張 =====
let cont = null;   // { base, state, prev, still, sig, count, timer, busy }

function beep(ok = true) {
  try {
    const a = cont && cont.audio; if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.value = ok ? 1175 : 330; o.connect(g); g.connect(a.destination);
    g.gain.setValueAtTime(0.25, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + (ok ? 0.18 : 0.35));
    o.start(); o.stop(a.currentTime + (ok ? 0.18 : 0.35));
  } catch {}
}

// 取框內畫面的縮圖（灰階 48x30），用來判斷有沒有動、有沒有東西
function sampleFrame() {
  const v = $('video'); if (!v.videoWidth) return null;
  const W = innerWidth, H = innerHeight, s = Math.max(W / v.videoWidth, H / v.videoHeight);
  const ox = (W - v.videoWidth*s)/2, oy = (H - v.videoHeight*s)/2, r = frameRect();
  const c = sampleFrame.c || (sampleFrame.c = Object.assign(document.createElement('canvas'), { width:48, height:30 }));
  const g = c.getContext('2d', { willReadFrequently:true });
  g.drawImage(v, (r.x-ox)/s, (r.y-oy)/s, r.w/s, r.h/s, 0, 0, 48, 30);
  const d = g.getImageData(0, 0, 48, 30).data, out = new Float32Array(48*30);
  for (let i = 0; i < out.length; i++) out[i] = (d[i*4] + d[i*4+1] + d[i*4+2]) / 3;
  return out;
}
const frameDiff = (a, b) => { if (!a || !b) return 999; let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const frameStd = a => { let m = 0; for (const x of a) m += x; m /= a.length; let v = 0; for (const x of a) v += (x-m)*(x-m); return Math.sqrt(v / a.length); };

function recordOk(r) {
  const no = EN_FIRST(r.type) ? (r.ppno && r.ppno.length >= 6) || validId(r.idno || '') : validId(r.idno || '');
  return !!(no && primaryName(r) && r.birth);
}

function contUI(msg, color) {
  $('contMsg').textContent = msg;
  $('frame').style.borderColor = color || '#22c55e';
}

async function openContinuous() {
  let audio = null;
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); await audio.resume(); } catch {}   // 要在按鈕觸發時建立，iPhone 才會出聲
  await openCamera();
  if (!stream) return;
  cont = { base: docType, state: 'seek', prev: null, still: 0, sig: null, count: 0, busy: false, audio, fails: 0 };
  $('shutter').style.display = 'none';
  $('contBar').style.display = 'block'; $('contCount').textContent = '0';
  $('hint').textContent = '把證件放進框內，拿穩就會自動辨識';
  contUI('等待證件…', '#22c55e');
  cont.timer = setInterval(contTick, 350);
}
function stopContinuous() {
  if (!cont) return;
  clearInterval(cont.timer);
  const n = cont.count;
  cont = null;
  $('contBar').style.display = 'none'; $('frame').style.borderColor = '#22c55e';
  closeOverlay();
  setType(TYPES[docType] ? docType : 'id');
  if (n) toast(`連續掃描完成，共存了 ${n} 筆`);
}

async function contTick() {
  if (!cont || cont.busy) return;
  const f = sampleFrame(); if (!f) return;
  const d = frameDiff(f, cont.prev); cont.prev = f;

  if (cont.state === 'remove') {                 // 等你把上一張移開
    if (frameDiff(f, cont.sig) > 14) { cont.state = 'seek'; cont.still = 0; contUI('放下一張', '#22c55e'); }
    return;
  }
  if (cont.state === 'cool') {                   // 沒讀完整：等畫面變了再試
    if (frameDiff(f, cont.sig) > 6 || Date.now() > cont.until) { cont.state = 'seek'; cont.still = 0; contUI('再試一次，拿穩…', '#eab308'); }
    return;
  }
  // seek：畫面要有東西、而且連續幾次幾乎不動（不模糊）才辨識
  if (frameStd(f) < 18) { cont.still = 0; contUI('等待證件…'); return; }
  cont.still = d < 4 ? cont.still + 1 : 0;
  if (cont.still < 3) { contUI(d < 4 ? '拿穩…' : '偵測到證件，拿穩…', '#eab308'); return; }

  cont.busy = true; contUI('辨識中…', '#3b82f6');
  try {
    const card = cropFromVideo();
    setType(cont.base);
    await runOcr(card);
    let r = collectRecord(); r.sex = $('sex').value || inferSex(r);
    // 選「身分證」卻放了其他證件：改用通用辨識（會自動判斷類別）
    if (!recordOk(r) && cont.base === 'id') {
      setType('arc'); await runOcr(card);
      r = collectRecord(); r.sex = $('sex').value || inferSex(r);
    }
    if (!cont) return;
    if (recordOk(r)) {
      const key = primaryNo(r);
      if (load().some(x => primaryNo(x) === key)) { beep(false); contUI(`已經存過：${primaryName(r)}，請換下一張`, '#eab308'); }
      else {
        storeRecord({ ...r, confirmed:false });
        cont.count++; $('contCount').textContent = cont.count;
        beep(true); contUI(`✓ ${primaryName(r)}　${key}　已存檔，請移開`, '#16a34a');
      }
      clearFields(); $('cardView').style.display = 'none';
      cont.state = 'remove'; cont.sig = f;
    } else {
      cont.fails++;
      contUI('沒讀完整，稍微調整角度或避開反光', '#dc2626');
      cont.state = 'cool'; cont.sig = f; cont.until = Date.now() + 2500;
    }
  } catch (e) { contUI('辨識失敗：' + e.message, '#dc2626'); cont && (cont.state = 'cool', cont.sig = f, cont.until = Date.now() + 2500); }
  finally { if (cont) cont.busy = false; }
}
