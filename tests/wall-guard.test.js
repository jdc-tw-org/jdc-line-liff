/**
 * 守的是**守門本身**：`tests/manual/wall-guard.js` 會不會在「牆是空的」時真的紅。
 *
 * 為何要有這一檔（jdc-tw-org/jdc-line-gas#149，2026-09-17）：
 * 被它保護的 `tests/manual/wall-build-testpage.js` 是**手動**工具，`npm test` 的單層 `*`
 * 跨不進 `tests/manual/`、`syntax-check.yml` 只看 `*.html` 與 `assets/*.js`
 * ⇒ 那一格**零自動覆蓋**。守門要是被人改鬆（`>= 2` 改成 `>= 1`、`throw` 改成 `console.warn`），
 * 沒有任何東西會說話，而下一個人看到的又是一面沒人知道是空的牆。
 * 把純函式拆出來放這裡，就是為了讓這一條進得了 `node --test tests/*.test.js`。
 *
 * ⚠️ 這裡用合成的牆，**不呼叫真的 `buildArrivalWall`**：後端在另一個 repo，CI 上沒有那份檔，
 *    require 不到會是「測試沒跑到」而不是「測試通過」。守門讀的欄位名（`units`／`arrived`／
 *    `total`）萬一與後端分岔，指紋會退化成每輪相同 ⇒ 守門自己會紅（fail-closed），不會靜默放行。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { assertWallDiscriminates } = require('./manual/wall-guard.js');

/** 一輪牆。`n` 個人、`a` 個已到，單位順序照傳進來的。 */
const 牆 = (n, a, units) => ({
  total: n, arrived: a, notArrived: n - a, reveal: n - a <= 30, units: units,
});
const 單位 = (name, total, arrived) => ({ name, total, arrived });

/* ⬛ 對照組：真的會動的六輪——尺是活的，才有資格說別的案例是它抓到的。 */
test('會動的牆：不丟', () => {
  const seq = [0, 1, 2, 3, 4, 5].map((i) =>
    牆(40, i * 8, [單位('工務管理組', 20, i * 4), 單位('業務部', 20, i * 4)]));
  assert.doesNotThrow(() => assertWallDiscriminates(seq));
});

/* 🔴 本票的那個 bug：參加者的欄位名不是後端讀的那個 ⇒ 全被濾掉 ⇒ 每一輪都是空牆。 */
test('空牆（每一輪 total=0）：必須丟，而且訊息要指到欄位名', () => {
  const seq = [0, 1, 2, 3, 4, 5].map(() => 牆(0, 0, []));
  assert.throws(() => assertWallDiscriminates(seq), (e) => {
    assert.match(e.message, /牆是空的/);
    assert.match(e.message, /internalId/, '訊息沒說要去看哪個欄位 ⇒ 看到紅燈的人不知道往哪走');
    return true;
  });
});

test('死牆（有人但六輪一格都沒動）：必須丟', () => {
  const seq = [0, 1, 2, 3, 4, 5].map(() => 牆(40, 3, [單位('工務管理組', 40, 3)]));
  assert.throws(() => assertWallDiscriminates(seq), /六輪的牆完全相同/);
});

/* 少於兩輪＝根本比不出「會不會動」。不准靜默放行（這是最容易寫成 fail-open 的一格）。 */
test('只有一輪、空陣列、不是陣列：都必須丟，不准當成通過', () => {
  for (const bad of [[牆(40, 1, [])], [], null, undefined, '六輪']) {
    assert.throws(() => assertWallDiscriminates(bad), /比不出/,
      '輸入＝' + JSON.stringify(bad) + ' 時沒有丟錯 ⇒ 守門在退化輸入上是 fail-open');
  }
});
