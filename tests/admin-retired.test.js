/**
 * 🪦 **`admin.html` 退場成墓碑頁**（`jdc-tw/jdc-line-gas#99`，2026-09-18 擁有者拍板）。
 *
 * ══ 這個檔是三顆**活下來的突變**逼出來的，不是順手加的 ══════════════════
 *
 * 第一版沒有這個檔。我在 `admin.html` 的檔頭寫了一句
 * 「釘在 `tests/admin-retired.test.js` 的『本頁不再鑄造任何帶 token 的網址』那一條」
 * ——**而那個檔當時不存在**。⬛ 突變批次當場證明了那句話是假的：
 *
 *   M14  把一條 `board.html?t=X` 的卡片加回去   ⇒ **全綠（1298/0）**，活下來
 *   M15  把導向 `me.html` 的連結整個拿掉        ⇒ **全綠**，活下來
 *
 * 🔴 **M15 活下來的成因特別值得記**：`tests/back-to-me.test.js` 那條
 *    「`me.html` 只准出現在一個地方」用的是 `stripComments`，而它剝的是 **JS 註解**。
 *    `admin.html` 的檔頭是一整塊 **HTML 註解**，裡面逐字寫著 `me.html`
 *    ⇒ 連結被刪光之後，那個檔**仍然**在 carriers 名單裡 ⇒ 斷言照樣成立。
 *    （`feedback_comment_is_source_code` 第③形態：**讓自己的斷言假通過**，綠燈、看不見。）
 *    ⇒ 所以下面「必須有一條可點的連結」那條**只看 markup、不看註解**。
 *
 * ⚠️ 本檔的每一條都附**對照組**。沒有對照組的話，「掃不到」與「掃描器壞了」
 *    在輸出上長得一模一樣，而這一頁只有 100 多行、很容易整份讀成空字串。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RAW = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

/** 剝掉 HTML 註解之後的整頁（markup ＋ inline script，但沒有那塊墓碑散文）。 */
const MARKUP = RAW.replace(/<!--[\s\S]*?-->/g, '');
/** 只有 inline script，而且連 JS 註解也剝掉 —— 「程式碼真的在做什麼」。 */
const CODE = (MARKUP.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || []).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
/** 靜態 markup（沒有 HTML 註解、也沒有 `<script>`）。 */
const MARKUP_NO_SCRIPT = MARKUP.replace(/<script[\s\S]*?<\/script>/g, '');
/**
 * 🔴 **「這一頁實際上寫了什麼」＝靜態 markup ＋ 剝掉 JS 註解的程式碼。**
 *
 * ⚠️ **不可以只剝 HTML 註解就拿去掃。** 這一頁同時有兩種註解：
 *    檔頭那塊 `<!-- -->` 墓碑散文，**以及 `<script>` 裡的 JSDoc**。
 *    ⬛ 我第一版只剝了前者，於是兩條當場紅在自己的散文上：
 *      · 鑄造那條命中 `&t=` —— 來自 JSDoc 裡的 `?a=1&t=X&b=2` 這個**反例**
 *      · 「沒有 LINE 登入」那條命中 `liff.init` —— 來自墓碑散文裡的「`liff.init` 出現 0 次」
 *    **「刻意沒有 X」這句話本身含有 X**（`feedback_comment_is_source_code` 第⑤形態：
 *    永遠響的紅燈，比沒有判準更糟——執行者會學會無視那一格）。
 */
const REAL = MARKUP_NO_SCRIPT + '\n' + CODE;

/* ════════════════════════════════════════════════════════════════════════
 * 〇、零點：三把尺都要真的取到東西
 * ════════════════════════════════════════════════════════════════════════ */

test('⬛ 零點：三把尺（原文／剝註解／只剩程式碼）都取得到東西，而且一把比一把短', () => {
  assert.ok(RAW.length > 2000, '原文只有 ' + RAW.length + ' 字元 ⇒ 讀到的不是那一頁');
  assert.ok(MARKUP.length > 800, '剝註解後只剩 ' + MARKUP.length + ' 字元 ⇒ 剝過頭了');
  assert.ok(CODE.length > 300, '程式碼只剩 ' + CODE.length + ' 字元 ⇒ 抽法把它吃掉了');
  // ⬛ 這三個數字必須嚴格遞減——相等就代表某一步根本沒作用，
  //    而「沒作用」正是 M15 活下來的成因（剝錯種類的註解）。
  assert.ok(RAW.length > MARKUP.length, 'HTML 註解一個字都沒被剝掉 ⇒ 下面每一條都可能被散文騙過去');
  assert.ok(MARKUP.length > CODE.length, 'markup 與程式碼一樣長 ⇒ script 抽法壞了');
  assert.ok(REAL.length > 300 && REAL.length < MARKUP.length,
    'REAL（靜態 markup ＋ 剝註解的程式碼）長度 ' + REAL.length + ' 不合理 ⇒ 兩段的拼法壞了');
});

/* ════════════════════════════════════════════════════════════════════════
 * 一、🔴 三台鑄造機停產（M14 的對點）
 * ════════════════════════════════════════════════════════════════════════ */

test('🔴 本頁不再鑄造任何帶 token 的網址（M14：加一張回來就要紅）', () => {
  // 🔴 看 **MARKUP**（markup ＋ 程式碼、但不含註解）：鑄造可以發生在兩個地方——
  //    靜態 `href="...?t=..."`，或程式碼裡組字串。兩者都要擋。
  //    ⚠️ 不可以看 RAW：那塊墓碑散文自己就逐字寫著 `?t=`，看 RAW 是一盞永遠響的紅燈。
  const hits = REAL.match(/\?t=|&t=|\?mt=|&mt=/g) || [];
  assert.deepStrictEqual(hits, [],
    '`admin.html` 又在鑄造帶 token 的網址了（命中：' + hits.join('、') + '）。\n'
    + '🔴 這一頁是墓碑——它每鑄造一條，就是把已經拆掉的舊路再散播出去一條。');
  // ⬛ 對照組①：同一把尺量原文，**必須**命中（那塊散文提到了 `?t=`）
  //    ⇒ 證明尺認得出這個樣式，上面那個空陣列不是因為尺瞎了。
  assert.ok((RAW.match(/\?t=/g) || []).length > 0,
    '⬛ 連原文都掃不到 `?t=` ⇒ 這把尺是壞的，上面那個「沒有」什麼都不代表');
  // ⬛ 對照組②：拿一段已知含有鑄造的假原始碼餵同一把尺。
  assert.ok((`<a href="board.html?t=X">`.match(/\?t=/g) || []).length === 1, '尺量不到鑄造');
});

test('🔴 本頁不打任何後端（打了就代表它又需要身分了）', () => {
  ['GAS_URL', 'fetch(', 'XMLHttpRequest', 'jsonp', 'gasCall', 'getMsgLogToken'].forEach((s) => {
    assert.equal(CODE.indexOf(s), -1,
      '`admin.html` 的程式碼裡出現了 `' + s + '` ⇒ 它又在跟後端說話了。\n'
      + '這一頁沒有 LINE 登入（`liff.init` 0 次），任何一發請求都只能靠舊 token ⇒ 必定被拒。');
  });
  // ⬛ 對照組：同一把尺量一個**已知存在**於程式碼裡的字串。
  assert.ok(CODE.indexOf('replaceState') >= 0,
    '⬛ 掃不到已知存在的 `replaceState` ⇒ 上面那六個 -1 是抽法壞了，不是事實');
});

test('🔴 本頁仍然沒有 LINE 登入（它退場的理由之一，不可以悄悄長回來）', () => {
  // ⬛ 對照組：同一把尺量**原文**必須命中——那塊散文逐字寫著「`liff.init` 出現 0 次」
  //    ⇒ 證明尺認得出這個字，下面那三個 -1 不是因為尺瞎了。
  assert.ok(RAW.indexOf('liff.init') >= 0,
    '⬛ 連原文都掃不到 `liff.init` ⇒ 這把尺是壞的');
  ['liff.init', 'getIDToken', 'liff.login'].forEach((s) => {
    assert.equal(REAL.indexOf(s), -1,
      '`admin.html` 出現了 `' + s + '` ⇒ 有人在替墓碑補 LINE 登入。\n'
      + '要復活這一頁是一個決定，回 `#99` 問擁有者——他拍的是「退場」。');
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * 二、🔴 它必須留下一條出口（M15 的對點）
 * ════════════════════════════════════════════════════════════════════════ */

test('🔴 必須有一條**可點的**連結指向 me.html（M15：刪掉它就要紅）', () => {
  // 🔴 **只看 markup，不看註解。** M15 活下來就是因為那塊 HTML 註解裡有 `me.html`，
  //    而 `back-to-me.test.js` 的 `stripComments` 只剝 JS 註解 ⇒ 連結刪光了它照樣綠。
  const anchors = MARKUP_NO_SCRIPT.match(/<a\b[^>]*href="me\.html"[^>]*>/g) || [];
  assert.equal(anchors.length, 1,
    '指向 me.html 的 `<a href>` 有 ' + anchors.length + ' 個，只准恰好一個。\n'
    + '🔴 一個都沒有 ⇒ 這一頁變成一張沒有出口的白紙，而它存在的全部理由就是那條出口。\n'
    + '🔴 兩個以上 ⇒ 改文案時會漏掉其中一個。');
  // ⬛ 對照組：同一把尺對「註解裡的那一句」必須**回 0**——證明它真的沒在看註解。
  const 假的 = '<!-- 見 <a href="me.html">我的頁面</a> -->'.replace(/<!--[\s\S]*?-->/g, '');
  assert.deepStrictEqual(假的.match(/<a\b[^>]*href="me\.html"[^>]*>/g), null,
    '⬛ 尺把註解裡的連結也算進去了 ⇒ 上面那個 1 可能來自散文，M15 還是活的');
  // ⬛ 對照組：尺認得出真的連結。
  assert.equal(('<a class="card" href="me.html">x</a>'.match(/<a\b[^>]*href="me\.html"[^>]*>/g) || []).length, 1);
});

test('🔴 那條連結必須真的被接上點擊處理（standalone 模式下 `<a>` 會彈內嵌 Safari）', () => {
  assert.match(CODE, /querySelectorAll\('a\.card'\)/,
    '沒有把 a.card 接上 JS 導頁 ⇒ iOS「加到主畫面」時點下去會彈出內嵌 Safari');
  assert.match(MARKUP_NO_SCRIPT, /<a class="card"[^>]*href="me\.html"/,
    '那條連結沒有 `class="card"` ⇒ 上面那段 JS 選不到它，點擊處理等於沒接');
});

test('⬛ 頁面上要看得見「搬家了」這句話（整頁只剩一條連結時，人會以為是壞掉）', () => {
  const 文字 = MARKUP_NO_SCRIPT.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
  assert.match(文字, /搬家|改用 LINE 登入/, '頁面上沒有任何一句話說明為什麼這裡空了');
  assert.match(文字, /me\.html|我的頁面/, '頁面上沒有指出新的入口叫什麼');
});

/* ════════════════════════════════════════════════════════════════════════
 * 三、🔴 舊書籤帶進來的東西要被剝掉
 * ════════════════════════════════════════════════════════════════════════ */

test('🔴 `t` 與 `mt` 兩個參數都要從網址上剝掉（不是只剝 t）', () => {
  // 這一頁原本同時轉傳兩套憑證（`t`＝line-platform、`mt`＝hub 的 viewer token）。
  // 只剝一個的話，另一個會留在網址列上，而且會跟著 Referer 走到 me.html。
  assert.match(CODE, /replaceState/, '沒有 history.replaceState ⇒ 網址一個字都沒被改過');
  assert.match(CODE, /'t'/, "剝除清單裡沒有 `'t'`");
  assert.match(CODE, /'mt'/, "剝除清單裡沒有 `'mt'`");
  // ⬛ 對照組：`<meta name="referrer">` 是保險、不是主防線，但它也要在。
  assert.match(RAW, /<meta name="referrer" content="no-referrer">/,
    'referrer 那一行不見了 ⇒ 剝網址若在很舊的瀏覽器上失效，就沒有第二道了');
});

test('⬛ 剝法是逐個參數重組，不是字串挖洞（`&&` 那一型）', () => {
  // 🔴 **把頁面那段真的跑起來**，不是讀它的原始碼——讀原始碼證明不了它算得對。
  const m = CODE.match(/var kept=([\s\S]*?)\.join\('&'\);/);
  assert.ok(m, '抓不到重組那一段 ⇒ 下面的行為斷言沒有受測物');
  const kept = (search) => new Function('location', 'return (function(){'
    + 'var kept=' + m[1] + ".join('&'); return kept; })();")({ search: search });
  assert.equal(kept('?a=1&t=X&b=2'), 'a=1&b=2', '挖洞式剝除會留下空參數');
  assert.equal(kept('?t=X'), '', '只有 t 時要剝成空字串');
  assert.equal(kept('?t=X&mt=Y'), '', 't 與 mt 都要剝掉');
  // ⬛ 對照組：不該剝的一個字都不能少。
  assert.equal(kept('?a=1&b=2'), 'a=1&b=2', '把不相干的參數也剝掉了');
  assert.equal(kept(''), '', '空查詢字串要回空字串，不是拋');
});
