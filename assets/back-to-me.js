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
 * ⇒ 文案、位置、樣式、返回目標全部只寫在這個檔裡。
 *
 * ⬛ **這個設計已經兌現過一次**：擁有者看了第一版（頁尾的一顆灰鈕）之後說
 *    「那顆鈕放左上角，淡淡的一排字就好」——位置、形態、視覺三件事一起變，
 *    而六頁的 HTML **一行都沒有動**。
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
 * ⚠️ **瀏覽器返回鍵不受影響**：這一支只新增節點，沒有動 history
 *    （沒有 pushState／replaceState／`location.replace`），也沒有註冊 popstate。
 *
 * ══ 🔴 位置：內容欄的左上角（2026-09-17 擁有者改的）═══════════════════
 *
 * 第一版在**頁尾**。理由當時是「六頁的頂端長得完全不一樣，頁尾是唯一結構相同的位置」。
 * 擁有者看了畫面之後要左上角 ⇒ 那個理由沒有消失，只是**必須正面解決**。
 *
 * 六頁頂端實際上的三種形狀：
 *   · `board`／`stats`／`hr-stats`／`attend` —— 普通流，body 自己就是置中的內容欄
 *   · `line-messages` —— body 滿版無內距；**左上角被一枚 `position:fixed` 的商標佔著**
 *     （`.brandmark`，z-index 31），內容欄是 `.shell > .wrap`，還有一條 fixed 的月份滑桿
 *   · `line.html` —— 頂上蓋著一整片 fail-closed 的身分閘（`position:fixed;inset:0;z-index:9999`）
 *
 * ⇒ 規則是**「插進這一頁的內容欄，當它的第一個東西」**，不是「貼在視窗左上角」。
 *   `MOUNT_IN` 是唯一一張「哪一頁的內容欄是誰」的表；查不到就退回 `document.body`
 *   （那四頁的 body 本身就是內容欄，所以退路對它們是正解，不是降級）。
 *
 * 🔴 為何不用 `position: fixed` 貼視窗角落：那會跟上面三種東西都打架——
 *    要蓋過 sticky 標題列就得把 z-index 抬到 30 以上，於是它同時蓋住了那枚商標；
 *    抬不過去就會在捲動時被標題列吃掉。**兩個方向都是「遮住既有的東西」或「被遮住」。**
 *    留在普通流裡，這兩件事都不會發生——它跟著內容一起捲，不跟任何人搶圖層。
 *
 * ⚠️ **`line.html` 的身分閘沒過的時候，這排字看不見**（它在閘底下）。**這是刻意的**：
 *    那道閘是 fail-closed 的，它存在的意義是「還沒確認身分時，畫面上只有一句話」。
 *    要讓返回鍵浮在閘上面，就得給它 z-index > 9999 ——那等於從外面把那個設計拆掉。
 *    身分確認完、閘拿掉之後，這排字就在內容欄左上角，與其他五頁同一個位置。
 *
 * ══ 「淡淡的一排字」怎麼落地 ═══════════════════════════════════════════
 *
 * 樣式用**注入一塊 `<style>`**，不是寫在元素的 `style` 屬性上——因為
 * `:hover` 與 `:focus-visible` 沒辦法寫成行內樣式，而那兩格是**可用性**不是裝飾：
 * 🔴 **淡的是視覺，不是語意。** 一排低對比的小字如果連聚焦框都沒有，
 *    鍵盤使用者會完全不知道自己走到了哪裡。
 *
 * ⚠️ 每一個 CSS 變數都帶 fallback：六頁裡只有 `attend.html` 載入 `assets/ui.css`，
 *    其餘五頁各自帶著自己那份 `:root`（見 `ui.css` 檔頭的退場條件）。
 *    沒有 fallback 的話那五頁會拿到瀏覽器預設的藍色連結——**而且不會報錯**。
 * ⚠️ 顏色用 `--ink3`（色票裡最弱的那一階，`#9a9a96`）。**再淡就撐不住對比**，
 *    而票上明寫「桌面寬度下六頁都看得到」——淡到量不出來就是失敗。
 */
(function () {
  'use strict';

  /** 返回目標。**相對路徑、無查詢字串**——理由見檔頭①。 */
  var TARGET = 'me.html';
  /** 連結文字＝accessible name（檔頭④）。六頁共用這一個字串。 */
  var LABEL = '‹ 回功能選單';

  /**
   * 「這一頁的內容欄是誰」。**唯一一張表**，只有頂端結構特殊的頁需要列。
   * 沒列到的頁退回 `document.body`——那四頁的 body 本身就是置中的內容欄。
   *
   * ⚠️ 值是 CSS 選擇器，選不到時**靜靜退回 body**：那會讓位置跑掉，但不會炸掉
   *    整頁。`tests/back-to-me.test.js` 有一條在釘「這張表上的選擇器都還選得到東西」，
   *    版面改名時會紅——否則這種退化是零徵兆的。
   */
  var MOUNT_IN = {
    // 🔴 掛進**標題列本身**，不是 `.shell .wrap`。
    //    第一版掛在 `.wrap` 的最前面，實測 `elementFromPoint` 指回 `DIV.stickytop`
    //    ——那排字被整個蓋住，而**畫面上完全看不出有東西在那裡**。
    //    成因是標題列 `margin: calc(-1 * var(--pad-y)) 0 0`（往上拉 20px）＋ z-index 30
    //    ＋ `::before` 是不透明底色：它會把上面那 20px 連同任何東西一起蓋掉。
    //    標題列就是這一頁內容欄的頂端 ⇒ 掛進去，那排字才真的在左上角。
    'line-messages.html': '.stickytop',
  };

  var CSS = '#backtome{margin:0 0 4px;padding:0;line-height:1.5}'
    // ⚠️ **只有上內距，左右一律 0。** 實測（1280 寬）五頁的 body 內容盒左緣分別在
    //    284／304／276／304 px——body 自己已經有左右內距了，這裡再加 16px 的話，
    //    那排字會比它底下的標題**多縮排 16px**，看起來像對錯欄。
    // ⚠️ `--sat` 是安全區高度（`ui.css` 收成變數的那三個之一）。沒有它的頁退 0。
    + '#backtome.pad{padding:calc(12px + var(--sat,0px)) 0 0}'
    + '#backtome a{display:inline-block;font-size:13px;font-weight:400;'
    + 'color:var(--ink3,#9a9a96);text-decoration:none;'
    + '-webkit-font-smoothing:antialiased}'
    + '#backtome a:hover{color:var(--ink2,#6b6b68);text-decoration:underline}'
    // 🔴 可用性不跟著視覺一起淡掉：鍵盤聚焦時給足對比與一個看得見的框。
    + '#backtome a:focus-visible{outline:2px solid var(--b,#2f4858);outline-offset:3px;'
    + 'color:var(--ink,#2c2c2b);border-radius:2px}';

  function mount() {
    if (document.getElementById('backtome')) return;      // 重複掛載時只留一份

    if (!document.getElementById('backtome-css')) {
      var st = document.createElement('style');
      st.id = 'backtome-css';
      st.appendChild(document.createTextNode(CSS));
      (document.head || document.documentElement).appendChild(st);
    }

    var bar = document.createElement('div');
    bar.id = 'backtome';

    var a = document.createElement('a');
    a.href = TARGET;
    a.textContent = LABEL;
    a.referrerPolicy = 'no-referrer';                     // 檔頭③
    bar.appendChild(a);

    // 內容欄：查表，查不到就是 body（見 MOUNT_IN 的說明）。
    var sel = MOUNT_IN[pageName()];
    var host = null;
    if (sel) { try { host = document.querySelector(sel); } catch (e) { host = null; } }
    if (!host) {
      host = document.body;
      // body 自己當容器時，內距由這一支負責——`line.html` 的 body 左右內距很窄，
      // 而 `attend` 那幾頁靠 `ui.css` 的 `padding:20px 16px 40px`。給一個自己的，
      // 六頁才會落在同一個縮排上。
      bar.className = 'pad';
    }
    host.insertBefore(bar, host.firstChild);
  }

  /** 目前這一頁的檔名（`/board.html` → `board.html`）。 */
  function pageName() {
    var p = (location.pathname || '').split('/');
    return p[p.length - 1] || '';
  }

  // 與 `page-version.js` 同一套時機判斷：defer 的 script 執行時 readyState 已是
  // 'interactive'，所以多數情況走 else 那條直接掛上。
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
