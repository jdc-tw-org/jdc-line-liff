/**
 * liff-relogin.js — 後端說「LINE 憑證死了」時，**真的**把人重新登入一次。
 *
 * ══ 為何存在（2026-09-13）═════════════════════════════════════════════════
 *
 * 後端 `roles.js` 對 `line_bad_token` 回的話是「請關掉這一頁重新開啟以重新登入」，
 * 而**那個動作在結構上做不到**。實測（見下）：ID token 過期之後重開這一頁，
 * `liff.init()` 什麼都不會清、`liff.isLoggedIn()` 仍然是 `true`
 * ⇒ 各頁的 `if(!liff.isLoggedIn()) liff.login()` **整條被跳過**
 * ⇒ `liff.getIDToken()` 把**同一顆過期的 token** 再交出來一次
 * ⇒ 後端再回一次 `line_bad_token`。**照它說的做，會無限重複。**
 *
 * 🔴 **`liff.getIDToken()` 沒有任何到期檢查，而 SDK 從不更新那一格。**
 *    SDK 2.31.0（線上那支，md5 6714c9f82c20161dfb6d7a6284d2f931、129,699 bytes）：
 *      · `getIDToken` → `function dt(){return Ye(se.ID_TOKEN)}` ＝**純 storage 讀取**
 *      · `isLoggedIn` → `function Tt(){return!!pt()}`   ＝只問有沒有 access token
 *      · 登入時 access token 的壽命寫進 cookie（`gt(new Date(Date.now()+1e3*i))`），
 *        **id_token 存下去時一個到期時間都沒設**（`ht(r)`）
 *      · `init()` 唯一的自動登出：`!Xe() && Tt() && (Se('LIFF_STORE:expires:'+liffId) || $t())`
 *        ——判準是**那顆 cookie 還在不在**，與 ID token 過不過期無關；
 *        而 `Xe()`＝「在 LINE App 裡」，在 LINE App 裡這一整條分支**根本不跑**。
 *      · 整支檔 `refresh_token` → 0 次、`grant_type` → 1 次 ⇒ **沒有續期機制**。
 *
 * ⬛ **實測（不是讀原始碼推論）**：種一組「有效 access token ＋未過期的 expires cookie
 *    ＋已過期的 ID token」，跑真的 `liff.init()`，然後看那顆 ID token 還在不在。
 *      受測 (cookie 活)  外部瀏覽器  ID token 原封不動、isLoggedIn=true、getIDToken 取到那顆過期的
 *      受測 (cookie 活)  LINE App 內 同上（store 是 sessionStorage）
 *      ⬛對照(cookie 死) 外部瀏覽器  ID token → null、accessToken → null、isLoggedIn=false
 *    WebKit 與 Chrome **兩個引擎、三組全部一致**，且對照組證明「cookie 沒了時它真的會清」
 *    ⇒ 這個量法有鑑別力，不是兩組回一樣的東西。
 *
 * ⇒ 唯一真的能重新登入的路是 `liff.logout()` 再 `liff.login()`。
 *   `logout` → `$t()` → `St()`＝把 `se` 裡每一個鍵（含 `ID_TOKEN`）都 `removeItem`、
 *   並殺掉 expires cookie ⇒ **那是 SDK 裡唯一會移除 ID token 的地方**。
 *
 * ══ 防無窮迴圈 ═══════════════════════════════════════════════════════════
 *
 * 🔴 **自動登出＋自動登入本身就是一個迴圈的形狀**：登入回來、憑證還是不被接受，
 *    就會再登出再登入。所以第二次進來**必須不再自動登出**，改講一句實話。
 *
 * 旗標住在 `sessionStorage`。**這是量過才決定的**，不是猜的：
 *   ⬛ 實測「寫入 → 整頁導向離開本 origin → 導回來再讀」
 *      WebKit  受測 session=SET  local=SET ／ ⬛對照（全新 context）兩個都是 null
 *      Chrome  受測 session=SET  local=SET ／ ⬛對照 兩個都是 null
 *      ⇒ 兩個引擎都存活，且對照組回 null ⇒ 量法有鑑別力。
 *      **WebKit 這一格是必要的**：iOS 的 LINE 內建瀏覽器是 WKWebView，
 *      只量 Chrome 等於沒量到真正在用的那個引擎。
 *   選 `sessionStorage` 而不是 `localStorage` 的理由是**生命期剛好**：
 *     · 它要活過一次 `liff.login()` 的整頁導向（已實測會活過）
 *     · 它**不該**活到下一次開頁——`localStorage` 會讓「上週壞過一次」變成
 *       這台裝置從此再也不自動重新登入，而那個失敗沒有人看得出來。
 *   ⚠️ 旗標鍵刻意**不用 `LIFF_STORE:` 開頭**：`liff.logout()` 會把
 *      `LIFF_STORE:<liffId>:<se 裡的鍵>` 全部刪掉，撞上前綴＝自己把防線洗掉。
 *
 * 🔴 **旗標什麼時候清（#115）：重登之後第一次成功的回應（`r.ok === true`）。**
 *    改前從來沒清過 ⇒ 同一個分頁自動重登過一次之後，再開一小時第二次過期
 *    就直接蓋上「請聯絡資訊人員」（現場整天開著的 checkin／wall 最容易撞到）。
 *    · 成功＝新憑證被後端接受過 ⇒ 之後再過期是「又過了一小時」，不是迴圈，可以再重登一次。
 *    · 迴圈防護不變：重登回來**第一發就死**，中間沒有任何成功 ⇒ 旗標還在 ⇒ 講實話。
 *    · 只認 `ok === true`：`role_*` 也代表憑證過了守門，但刻意不算（判準越窄越不會誤清；
 *      最壞＝第二次過期給死路，不會迴圈）。batch 的外層 ok 算數（gas 的 batch 分派在守門之後）。
 *    · 🔴 這一頁已經決定導走或放棄（`window.__reloginActing`）之後的成功**不清**：
 *      過期邊界上 A 回死憑證、寫下旗標開始導走，B 的 ok 晚一點才回來 ⇒ 沒有這一道，
 *      B 會把剛寫的旗標洗掉，回來之後防線就沒了。
 *    · 清不掉（storage 拋例外）就留著：寧可少一次自動重登，不要迴圈。
 *
 * 🔴 **讀不到／寫不進 storage 時一律當成「已經試過」**（無痕視窗、封鎖 cookie）。
 *    方向是刻意的：寫不進去就沒有防線，此時**寧可不自動登出**——
 *    「叫他找資訊人員」是看得見的失敗，「一直自動重登」是看不見的那一種。
 *
 * ══ 涵蓋範圍 ═════════════════════════════════════════════════════════════
 *
 * 掛在各頁 `jsonp()` 的解析出口（與 `deny-no-role.js` 同一格）⇒ 一頁只改一處、
 * 涵蓋那一頁所有 action 呼叫點。**判斷本體只有這一份**，各頁不自己手寫。
 *
 * ⚠️ **跨 repo 的手動對齊**（同 `deny-no-role.js` 的形狀與同一個弱點）：
 *   這兩個代號取自後端 `jdc-line-gas` `line-platform/roles.js` 的 `GATE_REJECT`：
 *   `LINE_BAD_TOKEN`／`LINE_NO_TOKEN`。兩邊各有測試釘住自己那半，
 *   **沒有任何機械的東西逼兩邊相等**；改代號要同一次動兩個 repo。
 *
 * 🔴 **「哪些 reason 代表重登會有用」：前端只剩一份（本檔），加上後端的權威**（#115 收斂）
 *     ① `jdc-line-gas` `roles.js` 的 `GATE_REJECT`   ＝**權威**（跨 repo，手動對齊）
 *     ② 本檔的 `RELOGIN_REASONS`，經 `reloginUseful()` 對外 ＝前端唯一一份。
 *        它的測試斷言的是**寫死的期望值**，不是去讀 ① ⇒ ① 改了而這裡沒改，照樣綠。
 *   各頁（authz、me、line）**只准呼叫 `reloginUseful`／`reloginVerdict`**，不另抄代號；
 *   `tests/relogin-reasons-single-source.test.js` 掃原始碼守著（hr-stats 的文案表是明寫的例外，
 *   理由寫在那支測試裡）。
 *   🪦 沿革：2026-09-13 寫這段時記的是「三份」（本檔、me.html、gas），實際上 authz.html 還有
 *      第四份（#114 設計時發現）。兩份頁面副本已於 #115 刪掉、改讀本檔。
 *   ⚠️ 只取這兩個是刻意的——`GATE_REJECT` 的檔頭把拒絕分成三類，
 *      「重新登入會有用」那一類**就只有這兩個**。其餘（`line_unbound`、
 *      `line_ambiguous`、`line_upstream`、`role_*`）重登都沒有用，
 *      對它們登出只會把人多趕一趟。
 */

/** 「重新登入會有用」的代號。對齊後端 GATE_REJECT，見檔頭。 */
var RELOGIN_REASONS = ['line_bad_token', 'line_no_token'];

/** 防迴圈旗標。刻意不以 `LIFF_STORE:` 開頭，見檔頭。 */
var RELOGIN_FLAG_KEY = 'JDC_RELOGIN_TRIED';

/** 第二次還是不行時要講的話。**不再叫他做任何做不到的事。** */
var RELOGIN_EXHAUSTED_MSG = '已經自動幫您重新登入過一次，但系統還是不接受您的登入憑證。'
  + '再試一次不會有幫助，請聯絡資訊人員。';

/** 正在導去登入時的過場。灰字不是紅字——這是正常流程，紅色要留給真的擋住的情況。 */
var RELOGIN_GOING_MSG = '您的 LINE 登入憑證已失效，正在自動重新登入，請稍候…';

/**
 * 這個回應該怎麼處置。**純函式 ⇒ 測得到**，而「只對正確的代號登出」與
 * 「不管什麼代號都登出」在畫面上長得一模一樣。
 *
 * @param {{ok?:boolean, reason?:string}} r 後端回應
 * @param {boolean} alreadyTried 這次造訪已經自動重新登入過了嗎
 * @returns {'none'|'relogin'|'exhausted'}
 */
function reloginVerdict(r, alreadyTried) {
  if (!r || r.ok === true) return 'none';
  if (!reloginUseful(r.reason)) return 'none';
  return alreadyTried ? 'exhausted' : 'relogin';
}

/**
 * 這個代號重新登入有沒有用。**前端唯一的判準**（#115）：各頁要決定「給不給重登鈕」
 * 都問這一支，不另抄一份代號（見檔頭）。
 */
function reloginUseful(reason) {
  var s = String(reason == null ? '' : reason);
  for (var i = 0; i < RELOGIN_REASONS.length; i++) {
    if (RELOGIN_REASONS[i] === s) return true;
  }
  return false;
}

/** 旗標讀。**拿不到 store 一律回 true（＝當成試過了）**，見檔頭。 */
function reloginTried() {
  try {
    return sessionStorage.getItem(RELOGIN_FLAG_KEY) === '1';
  } catch (e) {
    return true;
  }
}

/** 旗標寫。回 false ＝**沒寫進去**，呼叫端不可以登出（會迴圈）。 */
function reloginMarkTried() {
  try {
    sessionStorage.setItem(RELOGIN_FLAG_KEY, '1');
    return sessionStorage.getItem(RELOGIN_FLAG_KEY) === '1';
  } catch (e) {
    return false;
  }
}

/**
 * 成功的回應 ⇒ 清掉防迴圈旗標（#115，規則見檔頭「旗標什麼時候清」）。
 * 回應原樣交還。`reloginOnDeadCredential` 對每一個非死憑證的回應都會先叫它；
 * 自己不把成功回應交給 `reloginOnDeadCredential` 的頁（line.html）要自己叫。
 */
function reloginSettle(r) {
  if (!r || r.ok !== true) return r;
  if (window.__reloginActing) return r;
  try { sessionStorage.removeItem(RELOGIN_FLAG_KEY); } catch (e) {}
  return r;
}

/**
 * 貼一層蓋整頁的話。沿用 `deny-no-role.js` 的做法（覆蓋層、不改寫 document.body）：
 * 並行中的其他請求 `.then` 仍會操作 DOM，把 body 抽掉會讓它們拿到 null 而拋錯。
 */
function reloginOverlay(text, isErr) {
  var ov = document.createElement('div');
  ov.setAttribute('id', 'relogin-overlay');
  ov.setAttribute('style', 'position:fixed;inset:0;z-index:99999;background:#fff;'
    + 'display:flex;align-items:center;justify-content:center;padding:24px;'
    + "font-family:-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif");
  ov.innerHTML = '<div style="max-width:460px;text-align:center;font-size:16px;line-height:1.9;'
    + 'color:' + (isErr ? '#ac1535' : '#555') + '">' + text + '</div>';
  document.body.appendChild(ov);
}

/**
 * 憑證死了就真的重新登入一次；已經試過就說實話。
 *
 * **回傳值原樣交還**，讓它後面的處置（各頁的失敗畫面、board-cache 的
 * `cacheVerdict`）一個都不少——這一支只加動作，不吃掉別人的回應。
 *
 * ⚠️ **`window.__reloginActing` 這道記憶體閂不是可有可無的**：一頁首載會並行
 *    打好幾支 action，憑證死的時候它們會**幾乎同時**回同一個代號。
 *    沒有它就會連呼好幾次 `logout()`／`login()`（同 `deny-no-role.js` 的
 *    `__deniedNoRole` 為何存在）。
 *
 * ⚠️ **刻意不像 `deny-no-role.js` 那樣延遲 2.5 秒再判。** 那一支要等，是因為
 *    「角色不符」可能只打到附屬功能、主功能其實有權。這一支不同：
 *    `gateActionByLine` **先驗憑證才查角色**，憑證死掉時**沒有任何 action 會成功**
 *    ——等待只會讓他多看 2.5 秒的載入中。
 */
function reloginOnDeadCredential(r) {
  var v = reloginVerdict(r, reloginTried());
  if (v === 'none') return reloginSettle(r);
  if (window.__reloginActing) return r;

  if (v === 'exhausted') {
    window.__reloginActing = 1;
    reloginOverlay(RELOGIN_EXHAUSTED_MSG, true);
    return r;
  }

  // 能力檢查排在旗標之前：SDK 不在的話不要白白燒掉那一次機會。
  if (!(window.liff && typeof liff.logout === 'function' && typeof liff.login === 'function')) {
    window.__reloginActing = 1;
    reloginOverlay(RELOGIN_EXHAUSTED_MSG, true);
    return r;
  }
  // 🔴 **旗標要先寫成功才可以登出。** 寫不進去就沒有防線 ⇒ 寧可不登出。
  if (!reloginMarkTried()) {
    window.__reloginActing = 1;
    reloginOverlay(RELOGIN_EXHAUSTED_MSG, true);
    return r;
  }
  window.__reloginActing = 1;
  reloginOverlay(RELOGIN_GOING_MSG, false);
  liff.logout();                                   // 唯一會移除 ID token 的地方
  liff.login({ redirectUri: location.href });      // 保留 query（?act= / ?mt= 等）
  return r;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    reloginVerdict, reloginUseful, reloginSettle, reloginOnDeadCredential, reloginTried, reloginMarkTried,
    RELOGIN_REASONS, RELOGIN_FLAG_KEY, RELOGIN_EXHAUSTED_MSG, RELOGIN_GOING_MSG,
  };
}
