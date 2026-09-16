/**
 * 功能內頁 → 分流頁（`me.html`）的返回入口。**全站唯一一份實作**（票 #104）。
 *
 * ══ 為何是一支 asset，不是六頁各寫一段 ═════════════════════════════════
 *
 * 現象（2026-09-16 實測）：`git grep -c "me\.html"` 掃六個功能內頁，
 * 五頁回 0、`line-messages.html` 回 1——而那 1 是一句註解，不是入口。
 * ⇒ 六頁都沒有回得去的路，使用者只能按瀏覽器返回鍵或重打網址。
 *
 * 直覺的修法是「六頁各加一個連結」。那正是這個 repo 反覆踩的形狀：
 * `assets/ui.css` 的檔頭記著同一套設計語彙被逐字手抄四份、
 * `assets/url-token.js` 的檔頭記著同一個取值判斷有四種寫法。
 * 兩次的症狀相同——**改一處，其他幾處不會跟著動，而且零錯誤訊息**。
 * ⇒ 文案、位置、樣式、返回目標全部只寫在這個檔裡。下次要改，改這裡一個地方。
 *
 * 掛法（與 `assets/page-version.js` 同形）：在 `</body>` 前加一行
 *   <script src="assets/back-to-me.js" defer></script>
 * 刻意不掛的頁：`me.html` 自己（它就是目的地）、以及不在分流清單上的工具頁。
 *
 * ══ 🔴 為何是 `<a href="me.html">`，而且網址後面什麼都不帶 ════════════
 *
 * ① **不帶查詢字串**。`board`／`stats`／`hr-stats`／`attend` 這幾頁認人有兩條路，
 *    其中一條是網址上的 `?t=`。相對連結 `me.html` 會**把整串查詢字串丟掉**，
 *    所以那串憑證不會被帶進網址列，也不會被複製給下一頁。
 *    （`me.html` 檔頭②寫得很明白：它不吃 `?t=`、也不產生任何帶 `?t=` 的連結。
 *      這一支要是順手把 `?t=` 接上去，等於從另一端把那個決定推翻掉。）
 *
 * ② **不碰任何憑證儲存**。`me.html` 的角色清單整份由後端 `listMyPages` 用
 *    LINE 的 idToken 算。一次普通的同源導頁不會動到 LIFF 的登入狀態
 *    ⇒ 回去之後拿到的是同一個 idToken、同一份清單。**身分不會被洗掉。**
 *    反過來說：任何「登出後重登」「換 redirectUri」「清 storage」的花招都不能加進來，
 *    那才會讓角色變少——而且畫面上看起來只是「少了一列」，不像故障。
 *
 * ③ **`referrerPolicy = 'no-referrer'`**。同源導頁預設會把**完整網址**（含 `?t=`）
 *    放進 Referer 標頭。網址列雖然乾淨，那串憑證仍會隨著請求走一趟。
 *    ⬛ 前置查證：全 repo 沒有任何一頁讀 `document.referrer`
 *      （`git grep referrer -- '*.html' 'assets/*.js'` 回 0 命中），所以拿掉不影響任何人。
 *
 * ④ **`<a href>` 而不是 `<button>` 或 JS 導頁**。`line.html` 是發訊表單，
 *    票上的硬條件是「返回不得送出草稿、驗證碼或訊息」。
 *    `<a href>` **在結構上就送不出東西**：它不是提交控制項，
 *    而且這六頁裡連一個 `<form>` 都沒有（實測 `git grep "<form"` 回 0 命中）。
 *    這是「做不到」，不是「不該做」。
 *    附帶好處：鍵盤可聚焦、Enter 可啟動、可中鍵開新分頁——**全是原生行為，一行都不必寫**。
 *    accessible name 就是連結文字本身，所以刻意**不加** `aria-label`：
 *    多加一個會蓋掉文字，日後改文案時那一格不會跟著動。
 *
 * ⚠️ **瀏覽器返回鍵不受影響**：這一支只新增一個節點，沒有動 history
 *    （沒有 pushState／replaceState／`location.replace`），也沒有註冊 popstate。
 *
 * ══ 位置：頁尾，在版本列上方 ═════════════════════════════════════════
 *
 * 六頁的**頂端**長得完全不一樣——`line-messages.html` 左上角是 fixed 的商標
 * 加一條 sticky 標題列（z-index 30／31，還帶著為 iPhone 安全區調過的算式），
 * `line.html` 頂上蓋著一整片 fail-closed 的身分閘（`position:fixed;inset:0;z-index:9999`），
 * 其餘四頁是普通流。要在這六種頂端做出「位置一致」，就得跟三套 z-index 打架。
 *
 * **頁尾的普通流是這六頁唯一結構相同、而且已經被驗過的位置**——
 * `assets/page-version.js` 就用 `document.body.appendChild` 掛在那裡，六頁裡五頁已經在跑。
 * ⇒ 沿用同一個位置：不疊圖層、不動安全區、不碰 sticky。
 *
 * ⚠️ `line.html` 的最後一張卡就是「③ 發送」。上緣的 `margin` 給得比一般段落寬，
 *    是為了讓這顆返回鍵與那顆送出鈕之間看得出斷點——兩者顏色、寬度、位置都不同，
 *    但距離仍然是唯一能防誤觸的那一格。
 *
 * ⚠️ **樣式寫在元素上，不靠 class**。六頁裡只有 `attend.html` 載入 `assets/ui.css`，
 *    其餘五頁各自帶著自己那份 `:root`（見 `ui.css` 檔頭的退場條件）。
 *    寫 `class="btn"` 的話，那五頁會拿到一顆沒有樣式的裸連結——**而且不會報錯**。
 *    ⇒ 用 CSS 變數並**每一個都給 fallback**：接上 `ui.css` 的頁拿到站上的色，
 *      沒接上的頁拿到寫死的同一組值。色值逐字取自 `ui.css` 的 `.btn`。
 */
(function () {
  'use strict';

  /** 返回目標。**相對路徑、無查詢字串**——理由見檔頭①。 */
  var TARGET = 'me.html';
  /** 連結文字＝accessible name（檔頭④）。六頁共用這一個字串。 */
  var LABEL = '‹ 回功能選單';

  function mount() {
    if (document.getElementById('backtome')) return;      // 重複掛載時只留一份

    var bar = document.createElement('div');
    bar.id = 'backtome';
    // 上緣留寬：`line.html` 的送出鈕就在正上方（見檔頭）。
    bar.style.cssText = 'margin:28px 0 4px;text-align:center;';

    var a = document.createElement('a');
    a.href = TARGET;
    a.textContent = LABEL;
    a.referrerPolicy = 'no-referrer';                     // 檔頭③
    // 逐字取自 ui.css 的 `.btn`（次要灰鈕）。**每個變數都帶 fallback**——見檔頭。
    a.style.cssText = 'display:inline-block;padding:9px 16px;border-radius:8px;'
      + 'font-size:14.5px;font-weight:600;text-decoration:none;'
      + 'background:#f0f0ee;color:var(--ink,#2c2c2b);'
      + '-webkit-font-smoothing:antialiased;';

    bar.appendChild(a);
    document.body.appendChild(bar);
  }

  // 與 `page-version.js` 同一套時機判斷：defer 的 script 執行時 readyState 已是
  // 'interactive'，所以多數情況走 else 那條直接掛上。
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
