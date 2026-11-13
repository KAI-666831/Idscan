// ===== 資料檢查：簡體轉繁體、生日合理性、同名不同號／同號不同人 =====

// 姓名常見的簡體字 → 繁體（辨識模型偶爾會吐出簡體）
const S2T_PAIRS = '黄黃颖穎华華国國伟偉杰傑丽麗军軍龙龍刘劉陈陳张張吴吳郑鄭许許谢謝罗羅叶葉苏蘇庄莊钟鍾赖賴杨楊萧蕭邓鄧冯馮韩韓贺賀卢盧顾顧汤湯荣榮验驗铃鈴议議书書宏宏晖暉辉輝东東兴興发發财財宝寶贵貴庆慶长長门門开開间間闻聞问問学學乐樂远遠进進连連运運达達过過还還边邊迈邁选選逸逸鸿鴻鹏鵬凤鳳鸣鳴莲蓮兰蘭芳芳红紅绿綠蓝藍紫紫银銀铭銘锋鋒镇鎮钰鈺锦錦钦欽铁鐵钢鋼锡錫铜銅泽澤涛濤沟溝渊淵湾灣浅淺滨濱洁潔沪滬汉漢涌湧润潤澜瀾灿燦炜煒烨燁焕煥炀煬灵靈爱愛宁寧实實宾賓宽寬岁歲岛島峰峰岗崗岚嵐帅帥师師广廣庐廬应應张張弥彌强強归歸录錄径徑忆憶怀懷恒恆恺愷悦悅惠惠惬愜愿願戏戲战戰户戶扬揚扬揚挥揮振振损損摄攝敬敬数數斌斌无無时時旷曠晓曉晋晉显顯晕暈书書会會杨楊极極构構枫楓荣榮桥橋梦夢检檢椭橢樱櫻权權欢歡毕畢气氣汇匯沧滄沥瀝泪淚浩浩济濟涧澗渔漁滚滾满滿潇瀟灯燈炼煉烟煙热熱焘燾爷爺牵牽犹猶猎獵献獻玛瑪玮瑋环環现現珐琺琼瓊璇璇电電画畫畅暢异異疗療皑皚盘盤码碼礼禮祯禎祷禱祸禍离離种種积積称稱稳穩穷窮竞競笔筆筑築简簡粮糧紧緊纪紀纬緯纯純纳納纶綸纷紛纸紙纹紋纺紡绍紹经經绘繪绢絹绣繡继繼绩績绪緒绮綺维維绵綿缘緣缤繽罗羅义義习習翘翹联聯聪聰肃肅胜勝脑腦舰艦艺藝节節芦蘆苍蒼茧繭荐薦荡蕩药藥莹瑩营營萝蘿蓝藍虑慮虽雖蚁蟻补補装裝见見观觀规規视視览覽觉覺誉譽计計订訂认認讯訊训訓记記讲講许許论論设設证證评評识識诗詩诚誠话話询詢该該详詳语語误誤说說请請诸諸读讀谊誼谋謀谦謙谨謹谱譜贝貝贞貞负負贡貢财財责責贤賢败敗货貨质質购購贴貼贵貴贷貸贸貿费費贺賀资資赐賜赏賞赖賴赵趙轩軒轮輪软軟轻輕载載辉輝辑輯输輸辽遼迁遷钊釗钧鈞钱錢钻鑽锐銳锭錠镜鏡闪閃闭閉闯闖阁閣阳陽阴陰际際陆陸陇隴陕陝随隨隐隱难難雾霧静靜顶頂顺順须須顿頓颂頌预預领領频頻颜顏额額飞飛饭飯馆館马馬驰馳驻駐验驗骏駿鱼魚鲁魯鲜鮮鸟鳥鹤鶴麦麥齐齊龄齡';
const S2T = {}; for (let i = 0; i + 1 < S2T_PAIRS.length; i += 2) S2T[S2T_PAIRS[i]] = S2T_PAIRS[i+1];
const toTrad = s => [...(s || '')].map(c => S2T[c] || c).join('');

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
