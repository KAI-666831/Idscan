// ===== 資料檢查：簡體轉繁體、生日合理性、同名不同號／同號不同人 =====

// 生日合不合理：太早（超過 100 歲）或晚於今天都不收
function birthOk(type, birth) {
  const b = (birth || '').trim(); if (!b) return false;
  const now = new Date(), Y = now.getFullYear();
  let y, m, d, mt;
  if ((mt = b.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = b.match(/^(\d{1,3})[\/.](\d{1,2})[\/.](\d{1,2})$/))) { y = +mt[1] + 1911; m = +mt[2]; d = +mt[3]; }
  else return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return y >= Y - 100 && dt <= now;
}

// 跟已存資料比對：同號不同人、同名不同號
function findConflict(r) {
  const no = primaryNo(r), nm = primaryName(r);
  for (const x of load()) {
    const xno = primaryNo(x), xnm = primaryName(x);
    if (no && xno === no) {
      if (xnm === nm && (x.birth || '') === (r.birth || '')) return { kind:'dup', msg:`已經存過：${nm}` };
      return { kind:'conflict', msg:`證號 ${no} 已存過，但資料不同（已存：${xnm} ${x.birth || ''}）` };
    }
    if (nm && xnm === nm && no && xno && xno !== no) return { kind:'conflict', msg:`${nm} 已存過，但證號不同（已存：${xno}）` };
  }
  return null;
}
// 清單上標出彼此衝突的資料
function conflictSet(a) {
  const bad = new Set();
  a.forEach((r, i) => a.forEach((x, j) => {
    if (i >= j) return;
    const sameNo = primaryNo(r) && primaryNo(r) === primaryNo(x), sameNm = primaryName(r) && primaryName(r) === primaryName(x);
    if ((sameNo && (primaryName(r) !== primaryName(x) || (r.birth||'') !== (x.birth||''))) || (sameNm && !sameNo && primaryNo(r) && primaryNo(x))) { bad.add(i); bad.add(j); }
  }));
  return bad;
}
