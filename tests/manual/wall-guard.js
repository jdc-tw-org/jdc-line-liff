/**
 * 進場牆測試頁的「這一輪到底有沒有測到東西」守門。**純函式、不碰 I/O。**
 *
 * 🔴 為何存在（jdc-tw/jdc-line-gas#149，2026-09-17）：
 * 測試頁造的假參加者寫 `empNo`，而後端 `buildArrivalWall` 2026-09-02 起濾的是
 * `internalId`（`p && p.internalId` 為假就整筆丟掉）⇒ **每一筆都被濾掉**，六輪全是 `0/0`。
 *
 * 而空牆**不報錯**：頁面正常渲染、正常跑完六輪、工具正常印出結果、退出碼 0。
 * 「牆是對的」與「牆是空的」在這支工具上**行為完全相同**——而這支是進場牆唯一的 UI
 * 驗收手段 ⇒ 進場牆的畫面從來沒有被真正看過，看到的一直是一面空牆。
 *
 * 所以這裡守的不是「資料對不對」，是**「這支尺有沒有刻度」**：
 * 六輪的牆如果每一輪都長得一模一樣，那麼不管畫面上有什麼，這一輪什麼都沒測到。
 *
 * ⚠️ 刻意只有**一個**判準（「至少要有兩種不同的牆」），不另外加一條「total 不能是 0」——
 *    total 全 0 時每一輪必然相同，已經被這一條抓住；多加一條擋同一件事，
 *    兩道會互相遮蔽，拿掉任一道都不會有任何突變變紅（`feedback_overlapping_guards_untested`）。
 *    「是空的」還是「是死的」寫在**錯誤訊息**裡當診斷，不是第二道閘門。
 *
 * ⚠️ 放在這裡而不是放在 `wall-build-testpage.js` 裡面，是為了讓 `npm test` 跑得到它：
 *    `node --test tests/*.test.js` 的單層 `*` 跨不進 `tests/manual/`，
 *    但 `tests/wall-guard.test.js` 可以 require 到這一支（同 `outdir.js` ／ `manual-outdir.test.js`）。
 *    守門本體被人改鬆（例如把 `>= 2` 改成 `>= 1`）時，CI 會紅。
 */

/** 一輪牆的指紋：人數、已到、有沒有給姓名、各單位的順序與進度。任一格變了就是不同的牆。 */
function wallSignature(w) {
  w = w || {};
  return [
    w.total, w.arrived, w.notArrived, !!w.reveal,
    (w.units || []).map(function (u) {
      return u.name + ':' + u.arrived + '/' + u.total;
    }).join('|'),
  ].join(' ');
}

/**
 * 六輪牆必須至少有兩種不同的樣子，否則丟錯。
 * @param {Array<Object>} seq `buildArrivalWall` 逐輪的回傳值
 * @throws {Error} 零鑑別力時丟出，訊息裡帶診斷
 */
function assertWallDiscriminates(seq) {
  if (!Array.isArray(seq) || seq.length < 2) {
    throw new Error('進場牆守門：只有 ' + (Array.isArray(seq) ? seq.length : 0) +
      ' 輪，比不出「牆會不會動」——這支工具的用途就是看它動，請至少給兩輪。');
  }
  var sigs = seq.map(wallSignature);
  var distinct = {};
  sigs.forEach(function (s) { distinct[s] = true; });
  if (Object.keys(distinct).length >= 2) return;

  // ── 到這裡＝每一輪的牆都長得一模一樣 ⇒ 這一輪什麼都沒測到 ──
  var w = seq[0] || {};
  var why = (Number(w.total) > 0)
    ? '牆有 ' + w.total + ' 個人，但六輪一格都沒動——報到名單（STEPS）沒有推進，' +
      '或是已報到的鑰匙與參加者的鑰匙對不起來。'
    : '🔴 牆是空的（每一輪 total=0）。最可能的原因是**假參加者的欄位名與後端讀的不一致**：' +
      '`buildArrivalWall` 濾的是 `p.internalId`，寫成別的名字（例如舊的 `empNo`）會被整筆丟掉，' +
      '而且不報錯。';
  throw new Error('進場牆守門：六輪的牆完全相同，這一輪什麼都沒測到。\n  ' + why +
    '\n  第一輪指紋：' + sigs[0]);
}

module.exports = { wallSignature, assertWallDiscriminates };
