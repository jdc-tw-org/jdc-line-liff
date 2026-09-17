/**
 * 🔴 **頁面打的 action ↔ 後端的身分矩陣，必須相容。**
 *
 * ══ 這一檔是哪一次故障生出來的（2026-09-12，線 X）═══════════════════════
 *
 * `attend.html`（副總的活動出席唯讀看板）**對 `view` 身分打不開**，蓋上全螢幕
 * 「連結已失效／這條看板連結已經停用」。**線上已壞約 3.5 週（起算 2026-08-19），
 * 而這個 repo 的 **921 條測試全綠**（2026-09-12 於 `9cbd1f5` 實測，不是轉述）。**
 *
 * ⏳ **那個 921 的量法（現在就跑得出來，而且要先切到那一顆）**：
 *
 *     git worktree add --detach /tmp/liff-9cbd1f5 9cbd1f5
 *     cd /tmp/liff-9cbd1f5 && node --test tests/*.test.js
 *
 *   ⬛ 2026-09-17 逐字重跑：`tests 921  pass 921  fail 0`，`rc=0` ⇒ **921 重現得出來。**
 *   ⚠️ **不要在今天的工作樹上跑這條指令去驗 921**——今天的總數是另一個數字
 *     （同日於 `main` `2d8cf67` 跑 `node --test tests/*.test.js` 回
 *      `tests 1254  pass 1254  fail 0`）。**921 是那一顆 SHA 的事實，不是這個 repo 的常數。**
 *   ⬛ **對照組**：上面兩個數字要**不一樣**。一樣就代表 worktree 沒切成功、
 *     或你其實跑的是同一棵樹 ⇒ 這一輪什麼都沒量到。
 *
 * 🔴 **這個數字是這一段的論據本身**（「全綠」才說得通「測試看不見它」），
 *    所以它不能只留結論——留結論就等於要下一個人相信一個他重跑不出來的數字。
 *
 * 鏈條（每一節都一手查過）：
 *   ① `attend.html` 開頁第一發是 `jsonp('batch', {list:[listActivities, getActivityStats]})`
 *   ② 後端 `roles.js` 把 `batch` 註冊成 `'any'`，而 `'any'` 實際是「任何**看板**身分」
 *      ⇒ view 走不到 `gateAction` 的 view 分支，落到 board 分支 ⇒ `token_invalid`
 *   ③ `assets/board-cache.js` 看到「無權限或連結已失效」開頭 ⇒ 判 `revoked`
 *   ④ 清快取 ＋ 蓋整頁覆蓋層
 *
 * 🔴 **成因不是②那一行寫錯，是沒有任何東西在問「這一頁打的 action，
 *    這一頁的身分打不打得到」。** 後端 `ci/roles-matrix/baseline.md` 白紙黑字
 *    記著 `batch | any | … view ·`——**資訊一直在，只是沒有人拿它跟頁面對照。**
 *
 * ══ 「那一頁的身分是誰」怎麼表達——**刻意不另立一張表** ═════════════════
 *
 * 最直覺的做法是寫一張「頁面 → 身分」的宣告表。**否決，理由是它腐爛時沒有東西會紅**：
 * 這個 repo 現成就有兩具屍體——
 *   · `tests/page-load.test.js` 的 `PAGES` **曾經**是手維護的；2026-09-12 有人加了一頁，
 *     加進清單前後測試數都是 906 ⇒ 新頁面沒有任何載入防護且**零訊號**。
 *     ⚠️ 那一顆**當天已被另一條線改成掃目錄**（`c3941db`），所以它現在是**歷史證據**，
 *        不是現況。留著是因為它證明了「手維護清單腐爛時沒有訊號」真的發生過；
 *        寫成現在式就會變成一句假話，而下一個人會照著那句話去「修」一個已經修好的東西。
 *   · 後端 `ci/roles-matrix/snapshot.js --check` 算得出漂移，但**沒有被掛進任何地方**；
 *     2026-09-12 在乾淨 HEAD 上跑它就是紅的（格子差集：漂了 `getRoleSourceStatus`／`rollbackRoleSource` 兩列；
 *     ⬛ 對照組：故意改壞一格 `approveCheckin`，同一條量法看得見）。
 * 兩顆都是「資訊一直在、沒有強制點」——跟本檔要修的那顆同一種病。
 *
 * ⇒ **改成問一個不需要知道使用者是誰的問題**：
 *
 *   🔴 `batch` 是**轉派器，不是授權邊界**。doGet 先對 `batch` 本身守門一次，過了才進
 *      `runBatch_`；`runBatch_` 再對每一支子 action 各守門一次（`batch.js` 的 `buildBatchResults`
 *      逐支呼叫 `ctx.gate`，擋下的那支不執行）。子項守門依「外層是哪條路認出來的」分兩條：
 *      · **token 路**：子項重跑 `gateAction(a, p.token)`——與 doGet 直接打那支 action 是**同一支函式**。
 *        唯一差別是刻意不傳 `SCOPED_TOKENS`：受限身分在子項恆為拒絕；「同一顆 token 同時登記在
 *        SCOPED 與別份名單」的碰撞子項看不到，但外層那一趟有傳 SCOPED，會先擋下。
 *      · **LINE 路**：子項問 `gateLineIdentity(a, 外層交下來的身分)`——doGet 直接打那支 action 時，
 *        `gateActionByLine` 認出身分後最後一步呼叫的就是**同一支**；子項吃的是外層同一趟認出的身分，
 *        不重驗簽、不重查名冊，而且它只收 `source === 'line'`（其他一律拒絕）。
 *      （證據：gas `dbc8b17`，隨 gas main `04022c4` 於 2026-09-13 上線。在那之前兩條路的子項都重跑
 *       `gateAction(a, p.token)`，LINE 路的 `p.token` 是空字串 ⇒ 子項除 public 外全擋。逐欄比對見 gas
 *       `line-platform/tests/batch-line-identity.test.js`「batch 子項與 doGet 單支逐欄相同」與「token 路」兩條。）
 *      ⇒ 放行＝外層放行 **且** 子項放行，所以外層那道門只會**減**、不會加——兩條路都成立：
 *        token 路的子項就是直接打那支時的同一支 `gateAction`；LINE 路的子項就是直接打那支時
 *        最後一步的同一支 `gateLineIdentity`。外層在兩條路上都只是多疊一道條件。
 *      ⇒ **外層的身分集合，不得比它所轉派的任何一支子 action 更窄。**
 *      更窄的那些身分，本來直接打得到那支 action，改走 batch 之後會在**外層**就被擋下。
 *      擋下時回什麼，兩條路不同（檔:行皆為 gas origin/main `04022c4` 的 `line-platform/`）：
 *      · **token 路**（外層是 `gateAction('batch', token)`，`Code.js:1382`）：
 *        - staff／view 這種「整份名單就是身分」的 token，外層不含它時落不進自己的分支、掉到 board 分支查無此 token
 *          ⇒ `GATE_MSG_LEGACY_DENY`「無權限或連結已失效。」，reason `token_invalid`
 *          （`roles.js:882`；常數 `roles.js:706`、代號 `roles.js:551`）。2026-09-12 attend 對 view 打不開就是這一格。
 *        - 帶角色的 scoped／board token 角色不符 ⇒ `GATE_MSG_OUT_OF_SCOPE`「此連結非您的權限範圍。」，
 *          reason `role_mismatch`（scoped `roles.js:877`、board `roles.js:894`；常數 `roles.js:682`、代號 `roles.js:541`）。
 *      · **LINE 路**（外層是 `gateActionByLine('batch', idToken)`，`Code.js:1378`；認出身分後交給
 *        `gateLineIdentity`，`roles.js:1051-1052`）：
 *        - 角色不符 ⇒ `GATE_MSG_OUT_OF_SCOPE`「此連結非您的權限範圍。」，reason `role_mismatch`（`roles.js:1097-1098`）。
 *        - 身分不是 `source === 'line'` ⇒ `GATE_MSG_LEGACY_DENY`「無權限或連結已失效。」，reason `token_invalid`
 *          （`roles.js:1090-1091`）。⚠️ 這一格今天兩個呼叫點都走不到：`gateActionByLine` 交進去的一定是
 *          `'line'`（`roles.js:1052`），`runBatch_` 也只在 `source === 'line'` 時才呼叫它（`Code.js:1706`）
 *          ⇒ 它是 fail-closed 的防線，不是使用者會看到的畫面。
 *        - 驗簽／換內部碼失敗那幾種（`line_unbound` 等）不屬於這裡：那是「認不出你」，不是「身分集合更窄」。
 *      前端的顯示也跟著分岔：`assets/board-cache.js:42` 只認「無權限或連結已失效」開頭 ⇒ 判 `revoked`、
 *      清快取＋蓋整頁；「此連結非您的權限範圍。」不會被判 `revoked`，只有載入 `assets/deny-no-role.js` 的頁
 *      （board／stats／hr-stats）在 2.5 秒內沒有任何一支成功時，才蓋「此連結非您的權限範圍」——attend.html 沒有載它。
 *
 *   這個判準**完全由頁面自己的子項清單推出來**，不必宣告受眾，
 *   所以沒有第二張表要維護，也就沒有腐爛的那一格。
 *
 * ⚠️ **public 的子項不參與聯集**：`'public'` 的語意是「不需要身分」，
 *    它不對呼叫者是誰做任何主張。算進去的話 `board.html` 會因為批了
 *    `getCheckinOptions`（public）而要求 `batch` 對匿名訪客開放——那是假警報。
 *    ⚠️ 判斷 public 走矩陣裡的 `roles` 欄，**不可以用「九種身分全中」反推**：
 *    日後多一種身分，反推的結果會靜默改變（用位置代替身分）。
 *
 * ══ 這道檢查抓不到什麼（寫在這裡，不要讓下一個人以為它守得更寬）═════════
 *
 * ⚠️ 它只管**走 batch 的**那條路。一頁若直接呼叫一支它的使用者打不到的 action，
 *    本檔**不會紅**——那需要「頁面 → 身分」的宣告，而那正是上面否決掉的東西。
 * ⚠️ 動態組出來的子項（`plan.send.map(a => ({a:a}))`，stats.html 報到分頁）抽不到。
 * ⚠️ 矩陣副本 `tests/fixtures/action-roles.json` 是**後端產的**（`jdc-line-gas`
 *    的 `ci/roles-matrix/export-json.js`，與 `roles-matrix.test.js` 共用同一份 fixture）。
 *
 * 🔴 **2026-09-13（線 J）更正兩句話。舊版這裡寫的是：**
 *    「它與後端漂移時，本檔只抓得到『出現了副本裡沒有的 action 名』這個方向（見下面的絆線）」
 *    ——**那句反了。那個方向本檔一條都抓不到。**
 *    下面的絆線第一行就是 `r.subs.filter(known)`，而 `known()` 是「副本裡有沒有這個鍵」。
 *    ⇒ **副本裡沒有的名字會被這個過濾器靜靜丟掉，不是被報出來。**
 *
 *    ⬛ 實測（2026-09-13，突變對）：
 *      · 突變 A：在 `attend.html` 的 batch 子項加一支 `{ a: '完全不存在的action' }`
 *        ——掃描器抽到了（`subs` 裡有它），本檔**退出碼 0、全綠**。
 *      · 突變 B（對照組）：改加一支副本認得、但不在 `batchAllowed` 的 `addActivity`
 *        ——本檔**紅**，而且紅的正是下面那條絆線。
 *      ⇒ 絆線抓的是「副本認得、但後端不收 batch」；**「副本不認得」是它的盲點。**
 *    ⇒ 所以在 2026-09-13 之前，**副本腐爛在這個 repo 裡是零偵測，不是「只有一個方向」。**
 *
 * 🔴 **副本的新鮮度現在守在後端**（唯一守得住的地方）：
 *    `jdc-line-gas` 的 `ci/roles-matrix/copy-guard.js`，掛在該 repo 的
 *    `.github/workflows/roles-matrix-guard.yml`，把本檔這份副本與 `roles.js`
 *    算出來的現況**逐字**比對（支數相同但某支身分被改窄，也會紅）。
 *
 *    **為什麼一定在那一側**：真理是 `roles.js`，而 `jdc-line-gas` 是**私有** repo，
 *    本 repo 的 CI 讀不到它。反向可讀（本 repo 是公開的）。⇒ 這個關係只有站在後端
 *    那一側才看得見。任何只讀這份副本的檢查，最多只能證明它內部自洽——
 *    **副本與雜湊會一起腐爛，永遠自洽。**
 *
 *    ⚠️ **驗法（別信這段話，去量）**：在 `jdc-line-gas` 跑
 *      `node ci/roles-matrix/copy-guard.js --liff <本 repo 的 checkout>`，看退出碼；
 *      或確認該 repo 的 `.github/workflows/roles-matrix-guard.yml` 真的在 main 上。
 *      這兩個 repo 的改動是**分兩顆合併**的——只合了本 repo 這一顆的話，
 *      上面那段就還不成立。
 *
 * ⚠️ 仍然沒有守門的是**另一件事**，不要混為一談：
 *    「這一頁**直接呼叫**的 action，這一頁的使用者打不打得到」。
 *    那需要「頁面 → 身分」的宣告，而那正是上面否決掉的東西。
 *    ⬛ 這個盲點今天有多大（2026-09-13 實測，**數字在 `26f341e` 之後重量過**）：
 *      下面每一條會掃頁面的斷言都以 `if (!r.callsBatch) return;` 開頭
 *      ⇒ **母體 13 頁裡只有 4 頁在它眼裡**（admin／attend／board／stats），
 *      其餘 9 頁 `callsBatch=false`、`subs=[]`。
 *      重量：`S.pages().map(S.scanPage).filter(r => r.callsBatch).length`
 *
 *    🔴 **`me.html` 就是這個盲點的第一個活體實例**（`26f341e` 進 main）：
 *      它開頁打 `gasCall(GAS_URL, 'listMyPages', …)`——**直接呼叫、不走 batch**，
 *      而且 action 名在**第二個參數** ⇒ `literalCalls()`（只認 `ident('str'` 的形狀）
 *      連抽都抽不到。實測 `S.scanPage('me.html')`：
 *      `callsBatch=false`、`subs=[]`、`calledStrings` 不含 `listMyPages`。
 *      ⇒ 這一頁今天**整頁都不在本檔的守備範圍內**，而它不是特例：
 *        它是母體裡那 9 頁的典型，只是最新的一頁。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = require('./helpers/action-scan.js');

const M = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'action-roles.json'), 'utf8'));
const FIX = 'tests/fixtures/action-scan-cases.fixture.html';

const known = (a) => Object.prototype.hasOwnProperty.call(M.actions, a);
const isPublic = (a) => M.actions[a].roles.indexOf('public') >= 0;
const who = (a) => M.actions[a].who;

/** 一頁的 batch 子項裡，會對「呼叫者是誰」提出要求的那些身分的聯集。 */
function demandedIdentities(subs) {
  const out = new Set();
  subs.filter((a) => known(a) && !isPublic(a)).forEach((a) => who(a).forEach((i) => out.add(i)));
  return [...out].sort();
}

/* ════════════════════════════════════════════════════════════════════════
 * 一、零點：沒有這幾格，下面每一條都可能在空集合上恆真
 * ════════════════════════════════════════════════════════════════════════ */

test('⬛ 零點：矩陣副本讀得到，而且是這個系統的量級', () => {
  assert.ok(Object.keys(M.actions).length > 80,
    '矩陣副本只有 ' + Object.keys(M.actions).length + ' 支 action ⇒ 副本壞了或產錯了');
  assert.ok(M.identities.length >= 9, '身分只有 ' + M.identities.length + ' 種');
  assert.ok(known('batch'), '副本裡沒有 batch ⇒ 這一檔整份失去意義');
  assert.ok(M.batchAllowed.length > 5, 'batchAllowed 只有 ' + M.batchAllowed.length + ' 支');
  // 🔴 矩陣要真的在分辨身分，不是每一格都相同（否則聯集比較恆真）
  assert.notDeepStrictEqual(who('batch'), who('getActivityStats'),
    'batch 與 getActivityStats 的身分集合相同 ⇒ 這份副本沒有鑑別力');
});

test('⬛ 零點：頁面母體是掃出來的，而且掃得到東西', () => {
  const ps = S.pages();
  assert.ok(ps.length >= 10, '只掃到 ' + ps.length + ' 頁 ⇒ 母體抽法壞了');
  assert.ok(ps.indexOf('attend.html') >= 0, '母體裡沒有 attend.html');
  // 母體是 readdir 現掃的，所以「有人加了一頁卻忘了加進清單」這件事不可能發生。
  const 實際 = fs.readdirSync(S.ROOT).filter((f) => /\.html$/i.test(f)).sort();
  assert.deepStrictEqual(ps, 實際);
});

test('⬛ 零點：batch 子項真的抽得到（抽法退化成 0 會在這裡紅）', () => {
  const 有子項的頁 = S.pages().map(S.scanPage).filter((r) => r.subs.some(known));
  assert.ok(有子項的頁.length >= 3,
    '只有 ' + 有子項的頁.length + ' 頁抽得到 batch 子項 ⇒ 抽法退化了');
  const a = S.scanPage('attend.html');
  assert.deepStrictEqual(a.subs.filter(known), ['getActivityStats', 'listActivities'],
    'attend.html 的兩支首載子項抽不到 ⇒ 本檔對它形同不存在');
  assert.equal(a.callsBatch, true, 'attend.html 打的是 batch，這一格認不出來就整條斷掉');
});

/* ════════════════════════════════════════════════════════════════════════
 * 二、對照組：證明掃描器分得出「呼叫」與「只是提到」
 *     🔴 這三格是本檔唯一能證明主斷言不是裝飾品的東西。
 * ════════════════════════════════════════════════════════════════════════ */

test('⬛ 對照組：board-cache.js 滿是 action 名，但一個呼叫點都沒有', () => {
  const code = fs.readFileSync(path.join(S.ROOT, 'assets/board-cache.js'), 'utf8');
  // 先證明這個對照組有鑑別力：它確實含有 action 名（否則「回 0」什麼都沒證明）
  const 提到的 = Object.keys(M.actions).filter((a) => code.indexOf("'" + a + "'") >= 0);
  assert.ok(提到的.length >= 10,
    'board-cache.js 只提到 ' + 提到的.length + ' 支 action ⇒ 這個對照組失效了，換一個');
  // 🔴 那些全是 `case 'x':` 的分片對照表標籤，不是呼叫
  assert.deepStrictEqual(S.batchItems(code), [], 'board-cache.js 不該有任何 batch 子項');
  assert.equal(S.literalCalls(code).some((c) => c.arg === 'batch'), false,
    'board-cache.js 不該被算成打了 batch');
});

/**
 * ⚠️ **這一條是「今天的線上檔案沒有漏出來」的實測，不是可突變證明的那一條。**
 *    `deny-no-role.js` 那句話被**兩道**擋著：它在區塊註解裡，而且外面還包著反引號
 *    （⇒ 就算不認得註解，也會被當成樣板字串）。兩道互相覆蓋 ⇒ 拿掉任一道它都不紅。
 *    真正單獨可突變的那一格在下面的反例集（①c 跨行、無反引號）。
 */
test('⬛ 對照組：deny-no-role.js 的註解裡寫著 jsonp(\'batch\'，掃描器必須不算', () => {
  const code = fs.readFileSync(path.join(S.ROOT, 'assets/deny-no-role.js'), 'utf8');
  // 有鑑別力：原文真的有那一串（沒有的話這條是空轉）
  assert.ok(code.indexOf("jsonp('batch'") >= 0,
    'deny-no-role.js 已經沒有那句註解了 ⇒ 這個對照組失效，換一個註解裡提到 action 的檔');
  assert.equal(S.literalCalls(code).some((c) => c.arg === 'batch'), false,
    '註解被算成呼叫點 ⇒ 載入它的三頁都會被誤判成打了 batch');
  // 它的連鎖後果：hr-stats.html 載入 deny-no-role.js 卻沒有自己打 batch
  assert.equal(S.scanPage('hr-stats.html').callsBatch, false,
    'hr-stats.html 被算成打了 batch ⇒ 註解漏出來了');
});

test('⬛ 對照組：反例集裡的六種近似陷阱，掃描器逐一分得出來', () => {
  const code = S.inlineScript(FIX);
  const calls = S.literalCalls(code);
  const args = calls.map((c) => c.arg);
  // ①註解裡的呼叫（行註解與區塊註解各一）②字串裡的呼叫 → 都不算
  assert.equal(args.indexOf('batch'), -1, '註解或字串裡的 jsonp(\'batch\') 被算成呼叫了');
  assert.equal(calls.some((c) => c.callee === 'jsonp' && c.arg === 'listActivities'), false,
    '單行區塊註解裡的 jsonp(\'listActivities\') 被算成呼叫了');
  // ①c 跨行區塊註解：**只有「認得區塊註解」擋得住**（正則字面值遇換行會放棄），
  //    所以這一格讓那道處理單獨可被突變抓到，不與 ①b 互相覆蓋。
  assert.equal(calls.some((c) => c.arg === 'getRosterExport'), false,
    '跨行區塊註解裡的呼叫被算進去了 ⇒ 區塊註解那一段處理沒有生效');
  // ③正則裡含引號、⑤除號後接引號 → 掃描器沒有被帶偏，後面那支真呼叫仍抽得到
  assert.ok(calls.some((c) => c.callee === 'jsonp' && c.arg === 'getActivityStats'),
    '正則／除號的陷阱把後面的真呼叫吃掉了');
  // ④switch 標籤不是呼叫
  assert.equal(calls.some((c) => c.arg === 'getHrPending' && c.callee !== 'jsonp'), false,
    'case 標籤被算成呼叫了');
  // batch 子項：兩種寫法都抽得到；⑥值是變數的抽不到（已知邊界，明著釘住）
  assert.deepStrictEqual(S.batchItems(code).sort(),
    ['getActivityStats', 'getHrPending', 'listActivities']);
});

/* ════════════════════════════════════════════════════════════════════════
 * 三、🔴 主斷言
 * ════════════════════════════════════════════════════════════════════════ */

test('🔴 batch 的身分集合，不得比它轉派的任何一支子 action 更窄', () => {
  const 允許 = new Set(who('batch'));
  const 違反 = [];
  S.pages().forEach((p) => {
    const r = S.scanPage(p);
    if (!r.callsBatch) return;
    const 要求 = demandedIdentities(r.subs);
    const 缺 = 要求.filter((i) => !允許.has(i));
    if (缺.length) 違反.push(p + ' ｜ 子項 ' + r.subs.filter(known).join(',')
      + ' 要求 [' + 要求.join(',') + ']，而 batch 只開給 [' + who('batch').join(',')
      + ']，缺 ' + 缺.join(','));
  });
  assert.deepStrictEqual(違反, [],
    '這幾頁的 batch 首載會把本來打得到子 action 的身分整個擋在門外，'
    + '而前端把那個拒絕翻譯成「連結已失效」的全頁覆蓋層：\n  ' + 違反.join('\n  '));
});

/* ════════════════════════════════════════════════════════════════════════
 * 四、絆線：矩陣副本過期的一個方向（副本裡沒有的 action 名）
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ **這條抓的是「副本認得、但後端不收 batch」。「副本不認得」是它的盲點**，
 *    不是它的守備範圍——`filter(known)` 會把那種名字丟掉（檔頭有突變對的實測）。
 *    副本的新鮮度由後端的 `copy-guard.js` 守，見檔頭。
 *
 * ⚠️ **`filter(known)` 不能直接拿掉。** 它在這裡兼了第二個差事：
 *    `S.batchItems()` 抽的是**整頁所有**的 `{ a: '字串' }`，不是「`batch` 呼叫裡
 *    `list:` 陣列內的」——兩者今天剛好一致，但不是同一件事。
 *    ⬛ 實測 2026-09-13（`26f341e` 之後重量，總數未變——`me.html` 沒有帶進新的
 *      `{ a: }` 字面值）：全部 13 頁共 21 個 `{ a: '字串' }`，其中 17 個是 action；
 *      另外 4 個是 `hr-stats.html` 的 `{a:'start'}`／`{a:'middle'}`×2／`{a:'end'}`
 *      （文字對齊設定，不是 action）。那一頁今天 `callsBatch=false` ⇒ 落在本條的
 *      母體之外，所以今天拿掉過濾器是 0 誤報。
 *      **但 `hr-stats.html` 哪天開始打 batch，就會冒出 3 種假警報**，
 *      而假警報會教會下一個人無視這條紅燈——比沒有這條更糟。
 *    ⇒ 要讓「副本不認得的名字」在本 repo 也會紅，得先把抽取範圍收進
 *      `batch` 呼叫的 `list:` 裡面。那是另一件事，還沒做。
 */
test('🟡 絆線：頁面上的 batch 子項都必須在後端的 batchAllowed 裡', () => {
  const allowed = new Set(M.batchAllowed);
  const 壞的 = [];
  S.pages().forEach((p) => {
    const r = S.scanPage(p);
    if (!r.callsBatch) return;
    r.subs.filter(known).forEach((a) => { if (!allowed.has(a)) 壞的.push(p + ' → ' + a); });
  });
  assert.deepStrictEqual(壞的, [],
    '這些子項後端不接受（會回「此 action 不支援 batch」），'
    + '或是矩陣副本過期了——重產：'
    + 'jdc-line-gas 跑 `node ci/roles-matrix/export-json.js --out <這裡>/tests/fixtures/action-roles.json`');
});
