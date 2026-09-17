/**
 * board-cache.js — 四個看板頁共用的持久快取、讀取佇列與撤銷遮蔽。
 *
 * 為何存在（2026-08-19）：GAS /exec 往返固定 1.7–2.1 秒且與資料量無關（實測），
 * 所以「只傳異動」省不到時間。唯一有效的是「不發請求就先把畫面畫出來」。
 * 原本四頁都有 SWR，但存在 sessionStorage——關掉分頁就清空，所以每次開頁都白等。
 *
 * 設計文件：yu-agent docs/superpowers/specs/2026-08-19-board-cache-prefetch-design.md
 *
 * 純函式（本段）刻意不碰 localStorage / WebCrypto，才測得到；
 * I/O 層在後段，用 __setStoreForTest / __setCryptoForTest 換掉外部依賴。
 */

var BOARD_CACHE_VERSION = 'v1';
var CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 快取過期了嗎。
 * 剛好 7 天不算過期（用 > 不用 >=）；savedAt 不是有限數字一律當過期，
 * 因為那代表資料損毀或格式舊了，讀進來只會在 render 時炸掉。
 */
function cacheExpired(savedAt, now) {
  if (typeof savedAt !== 'number' || !isFinite(savedAt)) return true;
  return (now - savedAt) > CACHE_TTL_MS;
}

/**
 * 🔴 **「被撤權了」的代號**——認到就清掉本機加密快取、蓋上覆蓋層。
 *
 * ⚠️ 值域的權威在後端（`jdc-line-gas` `roles.js` 的 `GATE_REJECT`），本檔只宣告
 *    「哪幾個代號該清快取」。這張表由 `tests/board-cache.test.js` 對著後端產出的
 *    `tests/fixtures/action-roles.json` 逐列驗——**代號打錯一個字母會紅**。
 *
 * ⭐ 判準只有一句：**他的權限是不是被收回了？** 不是「這次請求成不成功」。
 *
 *   `role_unresolved` 認得他，但算不出他的角色。**撤權就落在這一格**
 *                     （把他從授權名冊拿掉，`?t=` 與 LINE 兩條路都落這裡）。
 *                     ⚠️ 它還涵蓋「這把 token 沒有內部碼」與「接線漏了」兩種設定錯誤
 *                     ——那兩種也會清快取。**這是刻意的取捨**：快取只是速度，
 *                     清掉的代價是一次慢的開頁；不清的代價是他看得到不該看的資料。
 *   `token_invalid`   這把 token 在白名單裡驗不過（打錯、過期、**被撤掉**）。
 *                     ⚠️ 這一格是 2026-09-17 之前唯一會清快取的那條路（舊的撤權手法）。
 *
 * 🔴 **沒有列進來的一律不清**，而且下面三個是特別點名的：
 *   `role_mismatch`   身分還在，只是這支不開給他 ⇒ **不得清**。
 *                     2026-07-30 線上事故：看到權限訊息就蓋整頁，害人事看板
 *                     因一支附屬 action 被擋而整頁消失。
 *   `line_upstream`   「我們不知道」（打不到 LINE／讀不到名單）⇒ 上游一抖就清光全體。
 *   `line_needs_sheet` 角色來源的**回退鈕**。判成撤銷＝按下回退鈕就清光所有人的快取。
 */
var REVOKE_REASONS = { role_unresolved: true, token_invalid: true };

/**
 * 權威驗證請求的回應該怎麼處置快取。
 *
 * ══ 🔴 為何改吃代號（2026-09-17，gas #113）═══════════════════════════════
 *
 * 這一支原本靠 `msg.indexOf('無權限或連結已失效') === 0` 認「被撤權」。
 * ⬛ 實測（把後端 `roles.js` 真正的常數餵進這一支）：後端九句拒絕文案裡
 *    **只有一句**會判成 `revoked`，其餘八句全是 `ok`。
 * 🔴 **而權限被收回時，LINE 登入那條路吐的不是那一句**
 *    （它落在「系統目前讀不到您的權限設定。…」）⇒ 判 `ok` ⇒ **不清快取、不蓋覆蓋層**。
 *    ⚠️ 舊的 `?t=` 連結那條路沒有這個問題 ⇒ **同一個判斷、兩條路、結果相反。**
 *    （細節在私有票 `jdc-tw/jdc-line-gas#113`——本檔是公開 repo，不在這裡展開。）
 *
 * ⇒ 現在吃 `reason`。後端兩條路對撤權事件都送 `role_unresolved`，兩條路因此相等，
 *   而且 `tests/board-cache.test.js` 拿後端產出的信封表逐列釘住這件事。
 *
 * ══ ⚠️ 為何**還留著**那個字串比對（而不是拿掉）══════════════════════════
 *
 * 因為**還有不帶 `reason` 的生產者**。⚠️ 它們分兩種，而且**只有第一種被這條退路接住**：
 *
 *   ① `jdc-line-gas` `Code.js` handler 層、msg 剛好是那一句的（**75 處**）
 *      ⇒ 前綴命中 ⇒ **這條退路就是為它們留的**。
 *      那一層失敗的意思是「守門放行了、但這支功能要看板身分」，與守門層不是同一件事。
 *   ② 同一層、同樣不帶代號，但 msg 換了寫法的（另外兩種寫法共 **21 處**，
 *      另有 **1 處**寫成「…的檢視權限。」）；以及後端守門的 `allow === null`
 *      （action 不認得，共 **3 處**，**刻意不帶代號**——帶了就會對外洩漏哪些 action 存在）。
 *
 *      ⏳ **上面這四個數字的量法**（原本這裡只寫「量於 `main` `1d5784e`」＝**沒有量法**：
 *         ⬛ 2026-09-17 實測，同一句話換一種合理的讀法——把句號拿掉——①就變成 **77**。
 *         沒寫下判準時，下一個人重跑會拿到別的數字，而兩個數字都像是對的。）
 *
 *         在 `jdc-line-gas` 的 **repo 根目錄**跑（把每行開頭的 ` * ` 去掉）：
 *
 *           NODE_OPTIONS= node -e 'const fs=require("fs"),S=require("./line-platform/tests/helpers/source-scan.js");
 *           var c=S.stripComments(fs.readFileSync("line-platform/Code.js","utf8"));
 *           var r=S.stripComments(fs.readFileSync("line-platform/roles.js","utf8"));
 *           var n=(s,re)=>(s.match(re)||[]).length;
 *           console.log("①那一句="+n(c,/無權限或連結已失效。/g)
 *             +"  ②同層換寫法="+(n(c,/無權限/g)-n(c,/無權限或連結已失效/g))
 *             +"  ②檢視權限="+n(c,/檢視權限/g)
 *             +"  ③守門allow===null="+n(r,/allow\s*===\s*null/g))'
 *
 *         🔴 **判準逐字寫在上面，不是「數那一句」四個字**：
 *           ①**帶句號**（handler 層吐的是完整那一句）；
 *           ②是「含『無權限』」**扣掉**「含『無權限或連結已失效』的全部」
 *             ——扣的時候**不帶句號**，否則那兩處沒有句號的會被算進②，變成 23。
 *         ⬛ **對照組就是它自己印的另外三個數字**，跟①一起跑、不必另外想案例：
 *           尺壞掉時（路徑錯、`stripComments` 把整份吃掉）**四個一起變 0**
 *           ⇒ ①的數字只有在另外三個也對的時候才算數。
 *         ⬛ 2026-09-17 實跑，`main` `c4dd03c` 與 `1d5784e` 兩顆**逐字相同**：
 *           `①那一句=75  ②同層換寫法=21  ②檢視權限=1  ③守門allow===null=3`
 *         ⚠️ **這四個數字跟著 SHA 走，引用前先重跑。**
 *           後端補代號（`#140`）會讓①與②往下掉，那正是「該重量了」的訊號。
 *      🔴 **這一種現在就已經判成 `ok`**（⬛ 實跑本檔：`cacheVerdict({ok:false,msg:'無權限。'})` → `'ok'`）。
 *      前綴比對認的是**那一句**，不是「無權限這件事」⇒ 它們的撤銷遮蔽**不是將來會消失，是現在就沒有**。
 *      ⚠️ 這要後端補代號才解得掉（私有票 `jdc-tw/jdc-line-gas#140`）。**不要改成更寬鬆的前綴**——
 *      放寬前綴＝把「要不要清光他的快取」交給文案決定，而文案沒有人守。
 * ⇒ 拿掉字串比對＝①那些路徑的撤銷遮蔽**靜默消失**。所以它留著，但**只在沒有代號時才問**：
 *   帶了代號就以代號為準，不再看文字。
 *
 * 🔴 **這條退場條件有兩個端點，要一起刪。** 另一端在後端：那一句話逐字交給前端的
 *    那一格匯出（就是本檔測試讀的 `gateContract.legacyDenyMsg` 的來源）。
 *    它存在的唯一理由就是餵這條退路 ⇒ 退路刪掉，它也沒有用途了。
 *    ⭐ **權威是本檔這一份**（推導、量法、對照組、合成檢體、突變證明都在這裡）；
 *    後端那一份刻意只指過來、不重述——抄第二份就是同一把尺兩個副本，
 *    改一邊另一邊不會動，而且沒有錯誤訊息。位置見 `jdc-tw/jdc-line-gas#140`
 *    （本檔是公開 repo，不在這裡寫後端的檔案路徑）。
 *
 * 🪦 **`jdc-line-hub` 那個第二生產者已經不在這條路上了**（2026-09-16，hub#27）：
 *    `line-messages.html` 的 `EXEC_URL` 與 `callApi` 被整個刪掉，這一頁結構上
 *    再也拿不到 hub 的網址。⇒ 後端 `roles.js` 那句「同一句話有第二個生產者」已經過期。
 *
 * ⏳ **退場條件（擁有者 2026-09-17 拍板「留到改完」；量法同日修正，gas #140）：
 *    下面這條量法的第一個數字回 `0` 之後，`!reason` 那條退路與吃它的那條測試一起刪。**
 *
 *    🔴 **量法本身寫在這裡，不是「等它們改完」四個字**——下一個人要跑得出來才知道能不能刪。
 *    🔴 **而且它量的是「有沒有帶代號」，不是「有沒有那一句話」。**
 *       原本那條量法數的是字面文案 `無權限或連結已失效。` 的行數，有兩個洞、方向相反：
 *         · **假放行**：同一層另外兩種寫法它一個都數不到；而**光是改寫那 75 處的文案**
 *           就能讓它回 `0` ⇒ **一個代號都沒補，退場條件就宣告成立**。
 *         · **零鑑別力**：守門那幾格用的是常數名、不是字面量，尺看不到；它回的 `roles.js=1`
 *           是常數宣告本身 ⇒ 那幾格補沒補代號，這個 `1` **都不會動**。
 *
 *    在 `jdc-line-gas` 的 **repo 根目錄**跑（把每行開頭的 ` * ` 去掉）：
 *
 *      NODE_OPTIONS= node -e 'const fs=require("fs"),S=require("./line-platform/tests/helpers/source-scan.js");
 *      var PERM=/權限|auth|Auth|gate|Gate|allow|Allow|GATE_MSG/, n=0,y=0,all=0;
 *      ["Code.js","roles.js"].forEach(function(f){
 *        var s=S.stripComments(fs.readFileSync("line-platform/"+f,"utf8")).replace(/\s+/g," ");
 *        var re=/ok\s*:\s*false/g,m;
 *        while((m=re.exec(s))){ all++;
 *          var tail=s.slice(m.index, s.indexOf("}", m.index)+1);
 *          if(!PERM.test(tail))continue;
 *          if(/\breason\b/.test(tail)) y++; else n++; }});
 *      console.log("不帶代號="+n+"  帶代號="+y+"  全部拒絕出口="+all)'
 *
 *    它拿**整個回傳信封**（`{ ok:false …` 到對應的 `}`）當單位，不是拿「行」當單位。
 *    ⬛ 實測：改拿行當單位會多報 6 處（`reason:` 換行寫的那幾處），而那 6 處永遠清不掉
 *    ⇒ 退場條件會變成**永遠到不了**——那跟提早成立一樣沒用，只是壞在另一邊。
 *
 *    ⬛ **對照組就是它自己印的另外兩個數字，跟第一個一起跑、不必另外想案例**：
 *      尺壞掉時（路徑錯、剝註解把整份吃掉、正規式沒命中）三個數字**一起變 0**。
 *      ⇒ `不帶代號=0` 只有在後兩個數字仍然是大數字時才算數。
 *    ⬛ **合成檢體實測（2026-09-17）**：一份含三種文案各一＋常數名兩處＋`reason` 換行寫一處＋
 *      一句無關的拒絕（`找不到員工名冊`）的檢體 ——
 *        新尺回 `不帶代號=7 帶代號=2 全部=10`（三種文案與常數名**全部數得到**，
 *        無關的拒絕沒被數進去，換行帶代號的那處正確歸到「帶代號」）；
 *        ⬛ 舊尺跑**同一份**檢體回 `Code.js=2 roles.js=1` ⇒ 兩個方向都錯。
 *      再把檢體全部補上代號 → `不帶代號=0 帶代號=4 全部=5`（**0 到得了**）；
 *      任拿掉其中一處的 `reason` → `不帶代號=1`（**不是恆 0**）。
 *
 *    ⚠️ 數字**跟著 SHA 走**：2026-09-17 於 `main` `1d5784e` 實跑回
 *      `不帶代號=105 帶代號=23 全部拒絕出口=433`；同日於後續一顆 `cdb66c2` 覆跑，三個數字不變。
 *      **讀到這段先重跑，不要照抄。**
 *    ⚠️ 不要用 `grep -c`：它數的是行、而且會數到註解裡的那幾句（本檔頭就寫了那句話好幾次）。
 *
 *    🔴 **這段退場條件不只寫在這裡。** 真正逼人看到它的是 `tests/board-cache.test.js`
 *      「沒有代號的生產者仍然靠那一句話認」那一條：把退路刪掉，那條會紅，
 *      而它的失敗訊息會把上面這條指令再講一次。
 *      檔頭是給**讀**的人看的，紅字是給**動手**的人看的——只寫檔頭等於沒有觸發點。
 *
 * ⚠️ 離線那一段**一個字都沒動**，而且仍然排在最前面。它用前綴比對不可改成完全相等：
 * 全站有四種離線字串變體（hr-stats.html:73 那句沒有「伺服器喚醒中」，
 * board.html 有一句只有「連線失敗」）。完全相等會讓 hr-stats 整頁判不出離線。
 * 🔴 離線的判斷**刻意留在這一次改動之外**：兩個判斷擠進一次改動，突變就分不出
 *    是哪一個在擋。
 *
 * ⚠️ 回 'ok' 的意思是「不需要對快取做任何事」，不是「請求成功」。
 */
function cacheVerdict(resp) {
  if (resp && resp.ok === true) return 'ok';
  var msg = String((resp && resp.msg) || '');
  if (msg.indexOf('連線逾時') === 0 || msg.indexOf('連線失敗') === 0) return 'offline';
  var reason = String((resp && resp.reason) || '');
  // 帶了代號就以代號為準——**沒列進 REVOKE_REASONS 的一律 'ok'**（fail-safe：
  // 日後後端多一個代號，預設是「什麼都不做」，不是「清光他的快取」）。
  if (reason) {
    return Object.prototype.hasOwnProperty.call(REVOKE_REASONS, reason) ? 'revoked' : 'ok';
  }
  // 沒有代號、而且 msg 剛好是這一句的生產者（Code.js handler 層、不認得的 action）只剩這句話可以認。
  // ⚠️ 同一層換了寫法的那些**接不住**（檔頭 ②）——這是後端補代號才解得掉的，不要靠放寬前綴。
  // ⏳ 退場條件與量法在檔頭；刪這一行之前先跑那條指令，看第一個數字是不是 0。
  if (msg.indexOf('無權限或連結已失效') === 0) return 'revoked';
  return 'ok';
}

/** 快取名稱建構器。跨檔案的契約集中在這裡，各處引用、不要自己組字串。 */
var N = {
  checkinOptions: 'getCheckinOptions',
  checkinPending: 'getCheckinPending',
  hrPending: 'getHrPending',
  anniversaries: 'getAnniversaries',
  rosterList: 'getRosterList',
  hrNotices: 'listHrNotices',
  options: 'listOptions',
  activities: 'listActivities',
  hrStats: 'getHrStats',
  activityStats: function (act) { return 'getActivityStats:' + (act || ''); },
  seating: function (actId) { return 'getSeatingBoard:' + actId; },
  stations: function (actId) { return 'listStaffStations:' + actId; },
  senior: function (year) { return 'getSeniorNotice:' + year; },
  preview: function (actId) { return 'previewPassBroadcast:' + actId; },
  attend: function (actId) { return 'attend:' + actId; }
};

/**
 * 一支切片該存成什麼名稱；回 null ＝ 這支不存。
 *
 * ⚠️ 名稱一律由 params（送出時實際用的參數）算，**不得從回應反推**——
 * batch 回應只有「action → 回傳值」，不帶回 actId，硬猜會把不同活動存成同一個名稱。
 */
function nameOfSlice(action, slice, params) {
  var p = params || {};
  switch (action) {
    // 2026-08-23 推翻設計 3.3.3 的「恆不落地」（使用者指示：照資深員工通知怎麼做）。
    // 只落地「沒帶範本」的那一份——它等於伺服器存起來的範本，跟重開一次頁面拿到的一樣。
    // 帶了範本＝使用者還沒按儲存的草稿，存下去會讓下次開頁秒顯一份根本沒存進伺服器的內容。
    // trim 後為空才算沒帶，與後端 String(tpl||'').trim() || passTemplate_() 同一條規則——
    // 只比 ==='' 的話，純空白會被當草稿，快取靜默永不命中。
    case 'previewPassBroadcast':
      return String(p.tpl || '').trim() ? null : N.preview(p.actId);
    case 'getActivityStats':     return N.activityStats(p.act);
    case 'getSeatingBoard':      return N.seating(p.actId);
    case 'listStaffStations':    return N.stations(p.actId);
    case 'getSeniorNotice':      return N.senior(p.year);
    case 'getCheckinOptions':    return N.checkinOptions;
    case 'getCheckinPending':    return N.checkinPending;
    case 'getHrPending':         return N.hrPending;
    case 'getAnniversaries':     return N.anniversaries;
    case 'getRosterList':        return N.rosterList;
    case 'listHrNotices':        return N.hrNotices;
    case 'listOptions':          return N.options;
    case 'listActivities':       return N.activities;
    case 'getHrStats':           return N.hrStats;
  }
  return null;   // 不認得就不存
}

// ── I/O 層 ────────────────────────────────────────────────────────────────
// 外部依賴（localStorage / WebCrypto）走這兩個變數，測試才換得掉。
// 沒有 store（隱私模式）或沒有 subtle（非 secure context）時，整個模組
// 退化成「永遠沒有快取」——頁面回到現行行為，不會壞，只是不快。
var _store = (typeof localStorage !== 'undefined') ? localStorage : null;
var _subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
var _mem = {};        // bootstrap 解出來的記憶體副本
var _revoked = false;
var _fpCache = {};    // token → 指紋，避免同一頁重複算 SHA-256

function _hex(buf) {
  var out = '', v = new Uint8Array(buf), i;
  for (i = 0; i < v.length; i++) out += ('0' + v[i].toString(16)).slice(-2);
  return out;
}

/** token 的指紋：SHA-256 前 12 個 hex。用來隔離不同人的快取。 */
function cacheFingerprint(token) {
  if (_fpCache[token]) return Promise.resolve(_fpCache[token]);
  if (!_subtle) return Promise.resolve('');
  var bytes = new TextEncoder().encode(String(token));
  return _subtle.digest('SHA-256', bytes).then(function (d) {
    var fp = _hex(d).slice(0, 12);
    _fpCache[token] = fp;
    return fp;
  });
}

function _keyOf(token) {
  var bytes = new TextEncoder().encode(String(token));
  return _subtle.digest('SHA-256', bytes).then(function (d) {
    return _subtle.importKey('raw', d, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  });
}

function _prefix(fp) { return 'jdcBoard:' + BOARD_CACHE_VERSION + ':' + fp + ':'; }

function _keysWithPrefix(pre) {
  var out = [], i;
  if (!_store) return out;
  for (i = 0; i < _store.length; i++) {
    var k = _store.key(i);
    if (k && k.indexOf(pre) === 0) out.push(k);
  }
  return out;
}

/**
 * 加密後寫入。obj.ok !== true 一律不寫，也不覆蓋既有的成功快取——
 * 存一個 {ok:false} 七天，等於讓下次開頁「秒顯一個錯誤畫面」，比慢還糟。
 * 回 Promise，且必須在加密真正落地之後才 resolve（佇列的「輪到自己時重讀快取」靠它）。
 *
 * ⚠️ 2026-08-19 修：原本只寫磁碟、不寫 _mem——同一個頁面生命週期內存進去的值，
 * cacheGet 讀到的仍是存檔前的舊值（cacheGet 只讀 _mem，_mem 只有 cacheBootstrap 會填）。
 * 實測：手動 cacheSave 後呼叫 load()，畫面停在「載入中…」不會秒顯。
 * savedAt 用同一個 payload 裡的時間戳，不另外呼叫 Date.now()——兩次呼叫會差幾毫秒，
 * 磁碟與記憶體對不起來，日後查問題會混亂。
 */
function cacheSave(token, name, obj) {
  if (_revoked || !_store || !_subtle) return Promise.resolve();
  if (!obj || obj.ok !== true) return Promise.resolve();
  var savedAt = Date.now();
  var payload = JSON.stringify({ value: obj, savedAt: savedAt });
  var iv = crypto.getRandomValues(new Uint8Array(12));
  return Promise.all([cacheFingerprint(token), _keyOf(token)]).then(function (r) {
    return _subtle.encrypt({ name: 'AES-GCM', iv: iv }, r[1], new TextEncoder().encode(payload))
      .then(function (ct) {
        var packed = _hex(iv) + '.' + _hex(ct);
        try { _store.setItem(_prefix(r[0]) + name, packed); } catch (e) { /* 滿額或被停用：略過 */ }
        _mem[name] = { value: obj, savedAt: savedAt };
      });
  }).catch(function () { /* 加密失敗不影響畫面 */ });
}

/**
 * 開頁時一次把該指紋的全部快取解密成記憶體 map。
 * 解不開／缺時間戳／過期的，邊解邊刪，不留無法使用的殘骸。
 * nowMs 只給測試用（Node 沒辦法把系統時鐘往前撥）。
 */
function cacheBootstrap(token, nowMs) {
  _mem = {};
  if (!_store || !_subtle) return Promise.resolve(_mem);
  var now = (typeof nowMs === 'number') ? nowMs : Date.now();
  return Promise.all([cacheFingerprint(token), _keyOf(token)]).then(function (r) {
    var pre = _prefix(r[0]), key = r[1];
    var jobs = _keysWithPrefix(pre).map(function (k) {
      var name = k.slice(pre.length);
      var packed = String(_store.getItem(k) || '');
      var dot = packed.indexOf('.');
      if (dot < 0) { _store.removeItem(k); return Promise.resolve(); }
      var iv = _unhex(packed.slice(0, dot));
      var ct = _unhex(packed.slice(dot + 1));
      return _subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct).then(function (pt) {
        var rec = JSON.parse(new TextDecoder().decode(pt));
        if (cacheExpired(rec && rec.savedAt, now)) { _store.removeItem(k); return; }
        _mem[name] = { value: rec.value, savedAt: rec.savedAt };
      }).catch(function () { _store.removeItem(k); });
    });
    return Promise.all(jobs);
  }).then(function () { return _mem; })
    .catch(function () { return _mem; });
}

function _unhex(s) {
  var out = new Uint8Array(s.length / 2), i;
  for (i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

/** 從 bootstrap 的結果同步取用。已撤銷時一律回 null。 */
function cacheGet(name) {
  if (_revoked) return null;
  return _mem[name] || null;
}

/**
 * 刪掉單一個快取鍵（磁碟＋記憶體一起）。
 *
 * 為何需要（2026-08-23）：其他卡片的失效靠「寫入後重載，用新資料覆寫同一個鍵」
 * （snLoad／stLoad／loadSeating 都是這個形狀，見 stats.html:1321 的註解）。
 * 報到碼通知走不了那條路——它的重載 bcPreview() 一定帶著輸入框裡的 tpl，
 * 而帶 tpl 的回應依 nameOfSlice 不落地，所以覆寫永遠不會發生。
 * 存範本／預約／取消／發送之後必須主動把那個鍵拿掉，否則下次開頁秒顯的是異動前的狀態。
 *
 * 刻意只做單鍵，不做前綴掃描——設計 3.3.3 當初拿掉 cacheDeletePrefix 的理由
 * （協調層、寫入屏障、跨分頁回灌）都來自前綴刪除，單鍵沒有那些。
 */
function cacheDrop(token, name) {
  delete _mem[name];
  if (!_store) return Promise.resolve();
  return cacheFingerprint(token).then(function (fp) {
    _store.removeItem(_prefix(fp) + name);
  }).catch(function () { /* 算不出指紋就等於沒有快取，不影響畫面 */ });
}

/** 只清當前指紋。撤銷用這支，不用 cacheClearAll——別人的 token 的快取不該被牽連。 */
function cacheClear(token) {
  if (!_store) return Promise.resolve();
  return cacheFingerprint(token).then(function (fp) {
    _keysWithPrefix(_prefix(fp)).forEach(function (k) { _store.removeItem(k); });
    _mem = {};
  });
}

/** 清所有 jdcBoard: 鍵。只給人工清理用，撤銷路徑不要呼叫它。 */
function cacheClearAll() {
  if (!_store) return;
  _keysWithPrefix('jdcBoard:').forEach(function (k) { _store.removeItem(k); });
  _mem = {};
}

/** 標記已撤銷：記憶體清空、之後 cacheGet 恆 null、cacheSave 變空操作。 */
function cacheRevoke() { _revoked = true; _mem = {}; }

/**
 * batch 回應的唯一存檔路徑。
 *
 * 為何不讓呼叫端自己取切片存：cacheSave 的守門只看它拿到的那個物件的 ok，
 * 外層整包丟進去就會過關，裡面的 {ok:false} 被夾帶著存七天。把拆包收在這裡，
 * 呼叫端拿不到犯這個錯的機會。
 *
 * 參數從 requestItems（送出的 list）拿，不從回應——後端 buildBatchResults 只回
 * 「action → 回傳值」，不帶回 actId/year/tpl。
 */
function persistBatchSlices(token, envelope, requestItems, nameOf) {
  if (!envelope || envelope.ok !== true || !envelope.results) return Promise.resolve();
  var byAction = {};
  (requestItems || []).forEach(function (it) { if (it && it.a) byAction[it.a] = it.p || {}; });
  var jobs = [];
  Object.keys(envelope.results).forEach(function (a) {
    var slice = envelope.results[a];
    var name = nameOf(a, slice, byAction[a] || {});
    if (name) jobs.push(cacheSave(token, name, slice));
  });
  return Promise.all(jobs).then(function () { });
}

/**
 * 「使用者動過的區塊，背景重繪不准蓋掉」。
 *
 * 為何存在（2026-08-20，誤發事故當天）：SWR 的形態是「先畫快取、網路回來再畫一次」。
 * 對名冊、統計數字這種唯讀區塊沒問題；**對含有輸入欄位的區塊，第二次繪製會靜默抹掉
 * 使用者已經表達的意圖**。當天 stats.html 的資深通知就是這樣——使用者取消勾選 18 人，
 * 約 2 秒後網路回來重繪、19 人全部勾回去，他按送出，19 位同仁各收到不該收的訊息。
 *
 * board.html 有兩處同樣形狀且更安靜：
 *   #pending    新人報到核准卡——姓名／生日／公司信箱／員工編號四個欄位，
 *               人事正在補打時被抹掉 → 錯的資料寫進名冊，**沒有任何提示**
 *   #hr-pending 人事異動——生效日（核定）
 *
 * 為什麼不用「資料相同就不重繪」的雜湊比對：那只在資料沒變時有效，
 * 而真正出事的時刻正是資料變了（所以才要重繪）。那是緩解，不是修好，
 * 而且會讓下一個人以為這裡已經安全（見 memory feedback_overlapping_guards_untested）。
 *
 * 用法：容器掛一次 watchDirty(id)，背景重繪前問 isDirty(id)；
 * 使用者主動觸發的重載（核准後刷新）呼叫 clearDirty(id) 再畫。
 *
 * 監聽用捕獲階段掛在容器上，子元素被 innerHTML 換掉也不必重掛。
 */
var _dirty = {};
function watchDirty(id) {
  if (typeof document === 'undefined') return;
  var el = document.getElementById(id);
  if (!el || el.__jdcDirtyBound) return;
  el.__jdcDirtyBound = true;
  var mark = function () { _dirty[id] = true; };
  el.addEventListener('input', mark, true);
  el.addEventListener('change', mark, true);
}
function isDirty(id) { return !!_dirty[id]; }
function clearDirty(id) { delete _dirty[id]; }
function __resetDirtyForTest() { _dirty = {}; }

/**
 * 讀取請求的序列佇列——同頁最多一支 /exec 在飛。
 *
 * 為何需要（2026-08-19）：「不並行」原本是一條要人記得的規則，而現況有三處
 * 違反（admin.html 兩支 seed、attend.html 兩支、stats.html 報到分頁的
 * stLoad()+bcPreview()）——每一處都是後來的人不記得規則。改成用了就成立的機制。
 *
 * ⚠️ 呼叫約定：fn 回的 Promise 必須在「網路回應 → 拆包 → 全部加密寫入完成」
 * 之後才 resolve。提早 resolve 的話，下一支排隊任務會讀到還沒落地的舊狀態、
 * 重複發送同一個請求。
 *
 * 只管讀取。寫入（jsonpW）刻意不排隊——那是使用者按了按鈕在等的動作，
 * 排在背景讀取後面會讓他覺得按鈕壞了。
 */
var GAS_TAIL = Promise.resolve();
function queueRead(fn) {
  var p = GAS_TAIL.then(fn, fn);      // 前一支成敗都往下走，不讓失敗卡住整條
  GAS_TAIL = p.catch(function () { });  // 尾巴永遠 resolved，避免 unhandled rejection
  return p;
}

/**
 * 撤銷時蓋上全頁覆蓋層。
 *
 * 放這裡不放 deny-no-role.js：那支只被 board/stats/hr-stats 載入，attend.html 沒有它。
 * 四頁都會載入本模組，放這裡才涵蓋得完整。
 *
 * ⚠️ 不延遲。deny-no-role 的 2.5 秒延遲是為了處理「附屬 action 被擋、主功能其實有權」；
 * 權威驗證請求被拒沒有這個歧義，要立即遮蔽——底下的畫面上有 153 人的姓名與意見。
 * 用覆蓋層不改寫 document.body：並行中的 .then 仍會操作 DOM，抽掉 body 會讓它們拿到 null。
 */
function revokedOverlay() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('jdc-revoked')) return;
  var ov = document.createElement('div');
  ov.id = 'jdc-revoked';
  // ⚠️ 不可只寫 `inset:0`——那是 Safari 14.1+ 才有的簡寫，舊 iOS 整條直接被丟棄，
  // 四個位移全部退回 auto → 覆蓋層縮成一個小白框，底下已經畫滿的 153 人姓名照樣看得見，
  // 而且零錯誤訊息。四個長寫屬性全站可用，先寫 inset 當現代瀏覽器的簡寫、再逐一覆寫。
  ov.setAttribute('style', 'position:fixed;inset:0;top:0;right:0;bottom:0;left:0;z-index:99999;background:#fff;'
    + 'display:flex;align-items:center;justify-content:center;padding:24px;'
    + "font-family:-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif");
  ov.innerHTML = '<div style="max-width:460px;text-align:center">'
    + '<div style="font-size:20px;font-weight:700;margin-bottom:12px;color:#ac1535">連結已失效</div>'
    + '<div style="color:#666;font-size:15px;line-height:1.8">這條看板連結已經停用。<br>'
    + '請聯絡系統維護者取得新的連結。</div></div>';
  document.body.appendChild(ov);
}

/**
 * 權威驗證請求回來之後的統一處置。撤銷時做完五件事：
 * 清持久快取 → 清記憶體 → （呼叫端負責丟棄第二發並停送 fallback）→ 蓋覆蓋層 → 停止寫入。
 */
function handleVerdict(token, resp) {
  var v = cacheVerdict(resp);
  if (v !== 'revoked') return Promise.resolve(v);
  return cacheClear(token).then(function () {
    cacheRevoke();
    revokedOverlay();
    return 'revoked';
  });
}

function isRevoked() { return _revoked; }

/**
 * 台北時區的當前西元年。
 * ⚠️ 不可用 new Date().getFullYear()——那跟著裝置時區走，跨年夜會與後端差一年。
 * 後端 getSeniorNotice 對空 year 的預設就是 Asia/Taipei 的當年（Code.js:3782），
 * 前端算出同一個數字送過去，回應完全相同、零行為變更。
 */
function currentTaipeiYear(nowMs) {
  var d = (typeof nowMs === 'number') ? new Date(nowMs) : new Date();
  // ⚠️ 一定要包 try/catch。舊 Safari／精簡版 ICU 的 Intl 對非 UTC 的 IANA timeZone 會丟
  // RangeError，而這支的呼叫端都在**同步的頂層路徑**上：stats.html 的 SECOND 組 batch 參數
  // 時呼叫它（拋出 → SECOND reject → 桌次／報到／員工三個分頁永遠停在「載入中…」），
  // snLoad 那條更是直接同步拋。與 2026-07-31 `AbortController` 在 iOS 12.1 炸掉整頁同型：
  // 新 API 在舊裝置上不是「功能降級」，是整段初始化當掉且畫面不顯示任何錯誤。
  // 退路取裝置時區的年——跨年夜可能與後端差一年，但那遠好過整頁不能用。
  try {
    return Number(new Intl.DateTimeFormat('en-CA',
      { timeZone: 'Asia/Taipei', year: 'numeric' }).format(d));
  } catch (e) {
    return d.getFullYear();
  }
}

/** 「月/日 時:分」。offlineLabel 與 refreshFailText 共用，時間只有一種寫法。 */
function _mdhm(ms) {
  var d = new Date(ms);
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}

/** 離線時附在 meta 列的一句話。時間取該筆快取的 savedAt。 */
function offlineLabel(savedAt) {
  return '離線·資料停在 ' + _mdhm(savedAt);
}

/* ══ 「畫的是快取、而這次刷新失敗」要說出來（2026-09-13）═══════════════════
 *
 * 🔴 為何存在：全站 SWR 區塊失敗時的既有寫法是 `else if(!cached) 畫錯誤`
 *    ——**有快取就一個字都不說**。⑤（強制走 jdc-identity）上線後，身分服務的
 *    四種失敗一律回 `line_upstream`，而人事看板會照常顯示最長七天前的待核准清單，
 *    按了核准才第一次看到錯誤。**服務壞了，前端替它藏起來。**
 *
 * ⚠️ 提示插在區塊**上方的兄弟節點**，不動區塊本身：區塊裡可能有人正在打字
 *    （memory feedback_swr_repaint_eats_user_input）。刷新失敗本來就不該重繪。
 * ⚠️ 不只 `line_upstream`：任何 ok:false 或取不到都算。列舉已知代號然後其餘靜默，
 *    就是這一次在拆的形狀。
 */

/** 提示文案。savedAt 不是有限數字＝沒存時間 ⇒ 寫「先前」，**不編造**。 */
function refreshFailText(savedAt, msg) {
  var when = (typeof savedAt === 'number' && isFinite(savedAt)) ? ' ' + _mdhm(savedAt) + ' ' : '先前';
  var m = String(msg == null ? '' : msg).trim() || '伺服器沒有回原因';
  return '⚠️ 這裡顯示的是' + when + '的資料，目前無法更新：' + m;
}

/** 在區塊 id 上方掛（或更新）提示。resp 可以是回應物件（取 msg／error）或字串。 */
function markRefreshFail(id, savedAt, resp) {
  if (typeof document === 'undefined') return;
  var box = document.getElementById(id);
  if (!box || !box.parentNode || !box.parentNode.insertBefore) return;
  var msg = (resp && typeof resp === 'object') ? (resp.msg || resp.error) : resp;
  var tag = document.getElementById(id + '-refail');
  if (!tag) {
    tag = document.createElement('div');
    tag.id = id + '-refail';
    tag.setAttribute('role', 'status');
    tag.setAttribute('style', 'margin:0 0 10px;padding:8px 12px;border-radius:8px;background:#fff4e5;'
      + 'border:1px solid #f0c36d;color:#8a5300;font-size:14px;line-height:1.6;font-weight:600');
    box.parentNode.insertBefore(tag, box);
  }
  tag.textContent = refreshFailText(savedAt, msg);
}

function clearRefreshFail(id) {
  if (typeof document === 'undefined') return;
  var tag = document.getElementById(id + '-refail');
  if (tag && tag.parentNode) tag.parentNode.removeChild(tag);
}

/**
 * SWR 第二段（網路那一段）回來時的統一處置。回 true＝呼叫端照原路畫（成功，或失敗但畫面上沒有快取）；
 * 回 false＝畫面停在快取、提示已掛上，呼叫端**不要畫**。
 *
 * 取代的是全站同一個兩行形狀：`if(r&&r.ok)畫(r); else if(!cached)畫(r);`
 * ——cached 為真而失敗的那一格原本什麼都不做。
 * @param {string} id      提示要掛在哪個元素上方
 * @param {*}      r       網路回應
 * @param {?{savedAt:number}} cached  畫面上那份快取；null＝畫面上沒有快取
 */
function settleRefresh(id, r, cached) {
  if (r && r.ok) { clearRefreshFail(id); return true; }
  if (cached) { markRefreshFail(id, cached.savedAt, r); return false; }
  clearRefreshFail(id);   // 沒快取 ⇒ 呼叫端畫錯誤框；舊提示要拿掉，不可兩個一起出現
  return true;
}

/**
 * 報到分頁要不要發請求、發哪幾支。純函式，才測得到——三條分支很容易寫反，
 * 而寫反的後果（多送一支／用到存檔版範本）在畫面上都不會報錯。
 *
 * ⚠️ 第二發還在飛時一律回「等」，不可直接拿它的 preview 切片：那份是用 tpl=''
 * 抓的存檔版，tpl 非空的呼叫者拿去用，畫面算的就跟他眼前輸入框裡的文字不同——
 * 而這一支的下游是「137 則 LINE 要發什麼內容」。
 */
function planCheckinBundle(st) {
  if (st.verdict === 'revoked' || st.verdict === 'offline') return { wait: false, send: [] };
  if (st.secondPending) return { wait: true, send: null };
  var send = [];
  if (!st.stationsCached) send.push('listStaffStations');
  if (!(st.tpl === '' && st.previewUsable)) send.push('previewPassBroadcast');
  return { wait: false, send: send };
}

/**
 * 「第二發（SECOND）的某個切片只能被消費一次」的判斷。回 true＝這次可以用切片，
 * 回 false＝已經用過，呼叫端必須自己重打。
 *
 * 為何存在（2026-08-19）：SECOND 是一個 Promise、只 resolve 一次，所以 pick2(a) 每次
 * 呼叫都回同一份「開頁當下」的快照。凡是**寫入之後的重載**都會被這份舊快照攔截：
 *   stats  刪資深通知範本 → snLoad()      索引位移，之後存到／發出錯的那一則
 *   stats  發 LINE       → snLoad()      發送紀錄不更新 →「已於 X 發送過」的警示不出現
 *                                          → 重複發送，收不回來
 *   stats  發佈桌次／移動座位 → loadSeating() 使用者看到剛做的操作當場退回去
 *   board  新增單位／職稱／改選項 → loadOptionsAdmin()  新選項不出現
 *   board  恢復已駁回異動 → loadLog()     仍顯示「已駁回」
 * 全部零錯誤訊息。第一發那條線本來就做了一次性旗標（board.html hrFirst、
 * stats.html statsFirst，註解寫「之後的刷新必須重打，不能回舊快照」），第二發漏了。
 *
 * 抽成純函式是為了測得到——pick2 活在頁面的 inline script 裡，測不到。
 * 用 hasOwnProperty 不用 usedMap[action] 直接判真假：action 若撞到 'constructor'
 * 這類原型上的名字，直接取值會拿到函式而永遠判成「已用過」。
 */
function takeOnce(usedMap, action) {
  if (!usedMap || typeof usedMap !== 'object') return false;   // 沒有帳本就一律當作不可沿用（保守）
  if (!action) return false;
  if (Object.prototype.hasOwnProperty.call(usedMap, action)) return false;
  usedMap[action] = true;
  return true;
}

function __setStoreForTest(s) { _store = s; _mem = {}; _revoked = false; _fpCache = {}; }
function __setCryptoForTest(c) { _subtle = c; _fpCache = {}; }
function __resetForTest() {
  _store = (typeof localStorage !== 'undefined') ? localStorage : null;
  _subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
  _mem = {}; _revoked = false; _fpCache = {};
}

if (typeof module !== 'undefined') module.exports = {
  BOARD_CACHE_VERSION: BOARD_CACHE_VERSION,
  CACHE_TTL_MS: CACHE_TTL_MS,
  cacheExpired: cacheExpired,
  cacheVerdict: cacheVerdict,
  REVOKE_REASONS: REVOKE_REASONS,
  N: N,
  nameOfSlice: nameOfSlice,
  cacheFingerprint: cacheFingerprint,
  cacheBootstrap: cacheBootstrap,
  cacheGet: cacheGet,
  cacheSave: cacheSave,
  cacheDrop: cacheDrop,
  cacheClear: cacheClear,
  cacheClearAll: cacheClearAll,
  cacheRevoke: cacheRevoke,
  persistBatchSlices: persistBatchSlices,
  queueRead: queueRead,
  watchDirty: watchDirty,
  isDirty: isDirty,
  clearDirty: clearDirty,
  __resetDirtyForTest: __resetDirtyForTest,
  revokedOverlay: revokedOverlay,
  handleVerdict: handleVerdict,
  isRevoked: isRevoked,
  offlineLabel: offlineLabel,
  refreshFailText: refreshFailText,
  markRefreshFail: markRefreshFail,
  clearRefreshFail: clearRefreshFail,
  settleRefresh: settleRefresh,
  currentTaipeiYear: currentTaipeiYear,
  planCheckinBundle: planCheckinBundle,
  takeOnce: takeOnce,
  __setStoreForTest: __setStoreForTest,
  __setCryptoForTest: __setCryptoForTest,
  __resetForTest: __resetForTest
};
