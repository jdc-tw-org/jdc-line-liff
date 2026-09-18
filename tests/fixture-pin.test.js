/**
 * **矩陣副本的指紋**：`tests/fixtures/action-roles.json` 是不是本 repo 宣告過的那一份。
 *
 * ══ 🔴 為何需要這一條 ═══════════════════════════════════════════════
 *
 * 那份 fixture 是**後端產的副本**。2026-09-14 實測：**把它換回舊副本，本 repo 全套照樣全綠。**
 * 守著它的只有後端那支 copy-guard，而**它住在另一個 repo，且永遠只比本 repo 的 `main`**
 * ⇒ 分支上換掉副本，在合併進 `main` 之前沒有任何東西看得到。
 *
 * ⚠️ **`_generatedBy` 那個欄位擋不住這件事。** 一手量過（新舊兩份副本）：
 *      `_generatedBy`   相同
 *      `identities`     相同
 *      `batchAllowed`   相同
 *      `actions`        **不同**
 *      `dispatchPages`  **不同**
 *    ⇒ 出身字串在兩份之間逐字相同，**它對「哪一份」零鑑別力**。
 *
 * ══ 這一條擋什麼、不擋什麼（寫清楚，否則下一個人會高估它）═════════════
 *
 *   ✅ 擋：**悄悄換掉那個檔**（換回舊副本、手改一個角色字串、合併時被別的分支蓋掉）。
 *   ❌ 不擋：**有意識地重產 fixture 並一起更新下面那個 PIN**。那本來就是正當動作。
 *   ❌ 不擋：**fixture 的內容對不對**。那是後端 copy-guard 的事，
 *      而且本 repo **刻意不抄一份角色表**——抄了就是同一個判斷散在兩處。
 *      這裡只認一個不透明的雜湊，不認語意。
 *
 * ⇒ 一句話：它回答「**這是不是我宣告過的那一份**」，不回答「這一份對不對」。
 *
 * ══ fixture 要更新時怎麼做 ═══════════════════════════════════════════
 *
 *   1. 在後端重產：`node ci/roles-matrix/export-json.js --out <這裡>/tests/fixtures/action-roles.json`
 *   2. 跑 `node --test tests/fixture-pin.test.js` ⇒ 它會**紅**，並把新的雜湊印給你
 *   3. 把下面的 `PIN` 換成它印出來的值，**在同一顆 commit 裡**
 *
 *   ⚠️ 第 3 步是刻意的摩擦。它要的不是防呆，是**留下一個「有人知道副本換了」的痕跡**。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FIXTURE = path.join(__dirname, 'fixtures', 'action-roles.json');

/**
 * 本 repo 宣告的那一份副本的 sha256（raw bytes）。
 * 2026-09-14：對應後端整合完（拿掉 welfare／broadcast ＋ 分流表加一列）之後重產的那一份。
 * 🔴 2026-09-15（gas #16）：後端把 `getMessageLog` 的 allow 拿掉 `hr`
 *    （擁有者 2026-09-14 拍板；原本是 `admin,activity,hr`）。
 *    ⚠️ **這一輪與前兩輪不同：`who` 真的變了，而且是「少一個」。**
 *      前兩輪（#15）只是每一支的 `roles` 多寫一個 `admin`，`who` 幾乎不動、
 *      實際可達權限零變化；這一輪 `getMessageLog` 的 `roles` 與 `who` **兩邊都少掉 `hr`**
 *      （diff 恰好 4 列，全在這一支底下）⇒ **持有 `hr` 的人真的少了一項權限**，
 *      分流頁由 2 頁掉到 1 頁（只剩 `board.html`）。後端擁有者已知情。
 *    ⇒ 本 repo 的 `page-action-gate.test.js` 與 `me-dispatch-wiring.test.js`
 *      判定會跟著變，那是**對的**，不是回歸。
 * 🔴 2026-09-15（gas #15，第二輪）：後端把 `admin` 寫進 `ACTION_ROLES` 的 **103 格（全部）**
 *    ⇒ 每一支的 `roles` 都含 `"admin"`。上一輪（PR #25）是 91 格，這一輪補完剩下的 12 格。
 *    ⚠️ `who` 只有**兩支**變（`recordEventCheckins`／`getEventCheckinSnapshot` 多了 admin）
 *      ——那是後端**第一道**的變化；第二道 `staffAuthFromIdentity_` 仍然擋著，
 *      後端逐身分 × 逐 action 實算：**實際可達權限多拿 0、少拿 0**。
 *    ⇒ 本 repo 的 `page-action-gate.test.js` 與 `me-dispatch-wiring.test.js` 判定不受影響。
 * 🔴 2026-09-15（gas #15）：後端把 `admin` 寫進 `ACTION_ROLES` 的 91 格 ⇒ 每一支的 `roles`
 *    多了一個 `"admin"`。**`who` 一格都沒動**（實測：diff 是 84 加 0 減，加的全是 `"admin"`），
 *    因為 `roleAllows` 本來就讓 admin 通吃 ⇒ 前端守門的判定零變化。
 */
/**
 * 🔴 2026-09-15（liff #17 ＋ gas #18）：分流表的**兩列改名**，副本跟著重產。
 *    diff 恰好 3 行，全在 `dispatchPages` 底下，**`actions` 一個字沒動**：
 *      `messages.html` → `line-messages.html`（liff `#17`，不轉址，舊網址就是 404）
 *      `welfare.html`  → `line.html`、title `LINE 傳送平台` → `line訊息發訊`（liff `#18` 整頁改名）
 *    ⇒ **沒有任何人的權限變了**：`ACTION_ROLES` 未動、gas 的矩陣基準檔差異只有被量檔的 sha256。
 *    ⚠️ 第二列是在補一個**已經存在的洞**：liff `#18` 2026-09-14 就合了，而 gas 的表沒跟著改名
 *      ⇒ 從那天起分流頁上「LINE 傳送平台」那個連結點下去是 404。
 */
/**
 * 🔴 2026-09-17（gas `#100`）：授權名單維護頁 `authz.html`。副本重產，diff 恰好兩塊：
 *      `actions`        **多三支**：`getAuthzList`／`checkAuthzDraft`／`saveAuthzList`，
 *                       三支的 `roles` 都是 `["admin"]`、`who` 都是 `["admin"]`
 *                       ⇒ **沒有任何既有 action 的格子被動到**（104 → 107 支）。
 *      `dispatchPages`  **多一列**：`authz.html`／`授權名單維護`／門 `getAuthzList`／`lineReady:true`。
 *    ⇒ 既有的人權限零變化；只有 `admin` 的分流頁多一列（6 → 7）。
 *    ⚠️ 這一列的 `lineReady:true` 前提是**本 repo 的 `authz.html` 已經發布**。
 *      gas 那一列的旁邊寫著同一件事：**liff 的副本先合、gas 後合**
 *      （`roles-matrix-guard.yml` 檔頭）。
 */
/**
 * 🔴 2026-09-17（gas #113）：副本多了 **`gateContract`** 這一段——後端「守門拒絕的信封表」，
 *    15 個情境各真的跑過一次 `gateAction`／`gateActionByLine`，出的是**要送進瀏覽器的
 *    那個信封**（`gateDenial` 的輸出），不是常數。
 *    ⚠️ **`actions`／`identities`／`batchAllowed`／`dispatchPages` 一個字都沒動**：
 *      重產前拿後端守門對這份副本比過，差異**只有「副本那份沒有 gateContract 這個鍵」**
 *      ⇒ **沒有任何人的權限變了**。diff 是 163 加 1 減（那 1 是 `]` 變 `],`）。
 *    為何而生：`board-cache.test.js` 那幾條是**手寫中文字串**、不讀後端任何東西
 *      ⇒ 後端改文案永遠不會紅。2026-09-16 線上真的對不上了
 *      （權限收回後 LINE 那條路不清快取），**而它全綠**。細節在私有票 `jdc-tw/jdc-line-gas#113`。
 *    ⚠️ 同一輪補了 `gateContract.legacyDenyMsg`：前端「沒有代號時」那條退路在認的那一句。
 *      它**不在任何一列信封的判定裡**（那幾列都帶 `reason`）⇒ 改它時逐列比對一格都不會動，
 *      所以它必須單獨出一格，否則那條退路壞掉沒有任何東西看得見。
 */
/**
 * 🔴 2026-09-17（合併，gas #113 × #100）：上面兩條**是同一份副本的兩塊改動**，
 *    在這一顆合併裡第一次同時出現，所以 PIN 換成**重產**之後的值，不是上面任何一個。
 *
 * ⚠️ **這個合併踩過一次、留在這裡當警告**：`git merge` 對 `action-roles.json`
 *    **不會衝突，它會靜默自動合併**（只有本檔與 `auth-inventory.baseline.md` 這兩個
 *    PIN 檔會衝突）。實測數字：
 *      git 自動合併出來的      `49e8fa9bb4c9`
 *      真的產生器重跑出來的    `d3a4dde18360`      ← 這一顆用的
 *    自動合併那份**少了 gate #113 後來補上的兩列信封**（`revoked_line_path_empty_roles`
 *    與對照組 `role_mismatch_line_real`）⇒ 直接沿用它，就等於**悄悄把那一格的守門拿掉**，
 *    而 PIN 會讓它看起來像是有人刻意宣告過的。
 *    ⇒ **合併這個檔的正確作法是「在 gas 重跑產生器」，不是挑一邊的 PIN。**
 *
 * ⚠️ 合併順序（承上面那條 gas `#100` 的註記）：**liff 的副本先合、gas 後合**
 *    （`roles-matrix-guard.yml` 檔頭）。
 */
/**
 * 🔴 2026-09-18（gas `#191`）：分流表多一欄 **`group`**（分流頁要分類、依分類排序、加小標）。
 *    副本重產，diff 恰好兩塊，**兩塊都只在 `dispatchPages` 底下**：
 *      ① 七列各多一個 `"group"`：人事（`board.html`／`hr-stats.html`）、
 *         活動（`stats.html`／`attend.html`）、LINE（`line-messages.html`／`line.html`）、
 *         管理（`authz.html`）。
 *      ② `hr-stats.html` 與 `stats.html` **對調**——後端改成照 `DISPATCH_GROUPS`
 *         的順序送出（人事 → 活動 → LINE → 管理），**那個順序就是分流頁的顯示順序**。
 *    ⚠️ **`actions`／`identities`／`batchAllowed`／`gateContract` 一個位元組都沒動**
 *      ⇒ **沒有任何人的權限變了**，也沒有任何一頁的認人方式變了。
 *      ⬛ 佐證不是我說的：`auth-inventory.baseline.md` 重產後的 diff **也只有指紋那一行**，
 *        41 行裡其餘 40 行（含逐頁的認人方式那張表）一個字沒動。
 *
 *    🔴 **為何類別非得是後端的一個欄位**：前端從 `title` 或檔名反推分類，
 *      是「用名字推定身分」——而標題真的會改（liff `#18` 就把 `welfare.html` 改成
 *      `line.html`、標題也換了）。推定式分類會在下次改標題時**靜默錯位**，
 *      而畫面看起來完全正常。
 *
 *    ⚠️ 合併順序（同上面幾條）：**本 repo 這顆先合，gas `#193` 後合。**
 *      在本顆合進 liff `main` 之前，gas 那邊的 `matrix-guard` 會紅在
 *      「liff 的矩陣副本必須是現行的」——**那個紅是對的，不是誤報。**
 *
 *    ⚠️ 本顆**不動 `me.html`**。分流頁真的把 `group` 畫成小標，是 liff `#61`。
 *      這一顆只讓副本與後端同步，好讓 gas `#193` 按得下去。
 */
/**
 * 🪦 2026-09-18（gas `#210`）：副本**少一個鍵** `gateContract.legacyDenyMsg`。
 *    diff 恰好一塊、**1 加 2 減**（那 1 是 `]` 變 `],` 的反向）——
 *    `actions`／`identities`／`batchAllowed`／`dispatchPages`／`gateContract.denials`
 *    ／`gateContract.reject` **一個位元組都沒動** ⇒ **沒有任何人的權限變了**。
 *    ⬛ 佐證不是我說的：`tests/auth-inventory.baseline.md` 重產後的 diff **也只有指紋
 *      那一行**，41 行裡其餘 40 行（含逐頁的認人方式那張表）一個字沒動。
 *
 * ⬛ 為何拆得掉：那一格出的是「前端沒有代號時那條退路在認的那一句」，**兩個端點
 *    今天都不在了**——退路本體在本 repo `#74` 拆除（`assets/board-cache.js` 的
 *    `cacheVerdict` 不再前綴比對）；最後一個消費者在本 repo `#84` 改成
 *    「契約表裡每一句拒絕文案，抽掉 `reason` 之後都必須回 `ok`」的**全稱命題**
 *    （`tests/board-cache.test.js`）⇒ 它不吃這一格，少了也照樣綠。
 *
 * 🔴 **合併順序：本 repo 這顆先合、gas `#210` 後合**（`roles-matrix-guard.yml` 檔頭）。
 *    ⚠️ 本顆合進 `main` 之後、gas 那顆合進去之前，gas 的 `roles-matrix-guard` 會紅在
 *      「liff 的矩陣副本必須是現行的」——**那個紅是對的，不是誤報**，而且
 *      **它不會自己消失**：本 repo 換 main 不會在 gas 那邊產生任何事件
 *      ⇒ 要在 gas 那張 PR 上手動 `gh run rerun <id> --failed`。
 *
 * ⬛ 實測（gas `chore/drop-legacy-export-210`，兩邊都是乾淨的 worktree）：
 *      重產前  `copy-guard.js --liff` rc=3
 *      重產後  `copy-guard.js --liff` rc=0（「逐字相同，107 支 action」）
 *    ⚠️ 量的時候**不要指到 `~/Projects/jdc-line-liff` 那棵**——它的 main 落後
 *      origin 一百多顆，會給出假的 rc=3「副本過期」。
 */
const PIN = 'd38a01296e3a95c4f86da22cf9192dce116845d18404a1527c38b461da3b10fd';

const raw = fs.readFileSync(FIXTURE);
const actual = crypto.createHash('sha256').update(raw).digest('hex');

test('🔴 矩陣副本就是本 repo 宣告的那一份（換掉它必須紅）', () => {
  assert.strictEqual(actual, PIN,
    '`tests/fixtures/action-roles.json` 不是本 repo 宣告的那一份。\n'
    + '  宣告：' + PIN + '\n'
    + '  實際：' + actual + '\n'
    + '  ⇒ 若是**刻意**重產的：把本檔的 PIN 換成上面「實際」那一串，在同一顆 commit 裡。\n'
    + '  ⇒ 若**不是**你換的：有人換掉了副本而沒有人宣告——先去問，不要直接改 PIN。\n'
    + '  ⚠️ 本條不檢查內容對不對（那是後端 copy-guard 的事），只檢查「是不是宣告過的那一份」。');
});

test('⬛ 對照組：這一條真的在讀那個檔，不是在比兩個常數', () => {
  // 沒有這一條，上面那句 assert 在「檔案讀不到」時也可能以別的方式綠掉；
  // 而且它釘住「PIN 是一個 64 位十六進位」這件事——打錯字會在這裡紅，不會在上面假綠。
  assert.ok(fs.existsSync(FIXTURE), '找不到 fixture ⇒ 上面那條什麼都沒驗');
  assert.ok(raw.length > 1000, 'fixture 只有 ' + raw.length + ' bytes ⇒ 它多半是空的或壞的');
  assert.match(PIN, /^[0-9a-f]{64}$/, 'PIN 不是 64 位十六進位 ⇒ 它永遠不會等於任何雜湊');
  assert.notStrictEqual(PIN, crypto.createHash('sha256').update('').digest('hex'),
    'PIN 是空字串的雜湊 ⇒ 有人把它當佔位符填進來了');
});

test('⬛ 零點：出身欄位存在，但**它不是鑑別力的來源**', () => {
  const m = JSON.parse(raw.toString('utf8'));
  assert.ok(m._generatedBy, '副本少了 _generatedBy ⇒ 它多半不是那支產生器產的');
  // 🔴 這一句記錄的是「為什麼不能只靠 _generatedBy」：
  //    2026-09-14 實測，新舊兩份副本的 _generatedBy **逐字相同**，而 actions 與
  //    dispatchPages 不同。⇒ 誰要是日後想拿掉上面那個 PIN、改成只驗這個欄位，
  //    等於把這一條變回一盞永遠的綠燈。
  assert.ok(typeof m._generatedBy === 'string' && m._generatedBy.includes('export-json.js'),
    '_generatedBy 變了樣 ⇒ 產生器換了，PIN 的意義要重新確認');
  assert.ok(Array.isArray(m.identities) && m.identities.length > 0, '副本沒有 identities');
  // 🔴 這句訊息原本寫「沒有 dispatchPages ⇒ 副本是舊版」——**那個推論是錯的**。
  //    驗證軌 2026-09-14 實測：已知的舊副本（`911a55f` 那份）**有** dispatchPages，
  //    而且是非空陣列 ⇒ 缺這個鍵代表的是「更早的版本，或根本不是那支產生器產的」，
  //    不是「舊版」這麼一個聽起來很近、卻會把人帶去重產一次然後發現沒用的結論。
  //    ⚠️ 同一句話也在 `me-dispatch-wiring.test.js` 裡（本條是從那裡抄來的），那邊還沒改。
  //    ⚠️ 條件用 `Array.isArray` 不用 truthy：`me-dispatch-wiring.test.js:156` 用的是前者，
  //       而本條原本只判 truthy ⇒ **遇到 `{}` 會一綠一紅**（驗證軌 2026-09-14 指出）。
  //       同一個判斷散在兩處而沒被要求相等，就是這個形狀的小號版本。
  assert.ok(Array.isArray(m.dispatchPages),
    'action-roles.json 沒有 dispatchPages ⇒ 這份副本不是現行產生器產的（可能更早，也可能根本不是它產的）。\n'
    + '  不要只是重產一次就算了——先確認產生器本身還會不會輸出這個鍵。');
});
