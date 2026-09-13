/**
 * 「畫的是快取、而這次刷新失敗」的提示（2026-09-13，⑤ 強制走 jdc-identity 的前提）。
 *
 * ══ 為何存在 ══════════════════════════════════════════════════════════════
 * ⑤ 上線後，身分服務的四種失敗一律回 `line_upstream`。全站的 SWR 區塊在「有快取」時
 * 的既有寫法是 `else if(!cached) 畫錯誤`——**有快取就什麼都不說**，畫面停在
 * 最長七天前的舊清單，沒有任何錯誤或離線提示。人事照著舊的待核准清單按核准，
 * 按下去才第一次看到錯誤。**身分服務壞掉，而前端把它藏起來了。**
 *
 * 本檔釘兩件事：
 *   ① 純函式：文案一定帶時間（沒存就寫「先前」，不編造）與後端 msg
 *   ② DOM：提示插在區塊**外面**（上方兄弟節點），不動區塊本身——
 *      區塊裡可能有使用者正在打的字（memory feedback_swr_repaint_eats_user_input）
 */
const { test } = require('node:test');
const assert = require('node:assert');
const BC = require('../assets/board-cache.js');

/* ── ① 文案 ─────────────────────────────────────────────────────────────── */

test('文案：有 savedAt → 帶「月/日 時:分」，且含後端 msg', () => {
  const t = BC.refreshFailText(new Date(2026, 8, 12, 9, 5).getTime(), '系統目前無法確認您的身分');
  assert.equal(t, '⚠️ 這裡顯示的是 9/12 09:05 的資料，目前無法更新：系統目前無法確認您的身分');
});

test('文案：沒有 savedAt → 寫「先前」，不編造時間', () => {
  for (const bad of [undefined, null, NaN, '', '1700000000000', Infinity]) {
    const t = BC.refreshFailText(bad, 'X');
    assert.equal(t, '⚠️ 這裡顯示的是先前的資料，目前無法更新：X', '輸入 ' + String(bad));
  }
});

test('文案：後端沒給 msg → 講出「沒有回原因」，不留一個冒號後面空白', () => {
  const t = BC.refreshFailText(null, '');
  assert.match(t, /目前無法更新：伺服器沒有回原因$/);
});

test('⬛ 對照組：時間格式與既有的 offlineLabel 同一套（兩處不各寫一份）', () => {
  const ms = new Date(2026, 0, 3, 14, 7).getTime();
  assert.equal(BC.offlineLabel(ms), '離線·資料停在 1/3 14:07');
  assert.ok(BC.refreshFailText(ms, 'm').indexOf('1/3 14:07') > 0);
});

/* ── ② DOM：插在外面、可更新、可清掉 ─────────────────────────────────────── */

/** 最小但「真的會插節點」的 DOM。只記 insertBefore 與 removeChild。 */
function makeDom() {
  const nodes = {};
  const parent = {
    kids: [],
    insertBefore(el, ref) {
      const i = this.kids.indexOf(ref);
      this.kids.splice(i < 0 ? this.kids.length : i, 0, el);
      el.parentNode = this;
      if (el.id) nodes[el.id] = el;
    },
    removeChild(el) {
      this.kids.splice(this.kids.indexOf(el), 1);
      delete nodes[el.id];
      el.parentNode = null;
    },
  };
  const box = { id: 'hr-pending', innerHTML: '<div class="card">舊清單</div>', parentNode: parent };
  parent.kids.push(box);
  nodes['hr-pending'] = box;
  const document = {
    getElementById: (id) => nodes[id] || null,
    createElement: () => ({ id: '', textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
  };
  return { document, parent, box };
}

function withDom(fn) {
  const dom = makeDom();
  const had = Object.prototype.hasOwnProperty.call(global, 'document');
  const prev = global.document;
  global.document = dom.document;
  try { return fn(dom); } finally { if (had) global.document = prev; else delete global.document; }
}

test('markRefreshFail：插在區塊**上方**，區塊本身的 innerHTML 一個字都沒動', () => {
  withDom(({ parent, box }) => {
    BC.markRefreshFail('hr-pending', null, '壞了');
    assert.equal(parent.kids.length, 2);
    assert.equal(parent.kids[0].id, 'hr-pending-refail', '提示要在區塊前面');
    assert.equal(parent.kids[1], box);
    assert.equal(box.innerHTML, '<div class="card">舊清單</div>', '清單被重繪了 ⇒ 會吃掉使用者正在打的字');
    assert.match(parent.kids[0].textContent, /壞了$/);
    assert.equal(parent.kids[0].attrs.role, 'status');
  });
});

test('markRefreshFail：重複呼叫只更新同一條，不疊出第二條', () => {
  withDom(({ parent }) => {
    BC.markRefreshFail('hr-pending', null, '第一次');
    BC.markRefreshFail('hr-pending', null, '第二次');
    assert.equal(parent.kids.length, 2, '疊出第二條提示');
    assert.match(parent.kids[0].textContent, /第二次$/);
  });
});

test('clearRefreshFail：刷新成功後提示消失；沒有提示時呼叫也不炸', () => {
  withDom(({ parent, box }) => {
    BC.clearRefreshFail('hr-pending');                 // 沒有提示
    assert.equal(parent.kids.length, 1);
    BC.markRefreshFail('hr-pending', null, 'x');
    BC.clearRefreshFail('hr-pending');
    assert.deepEqual(parent.kids, [box]);
  });
});

test('markRefreshFail：第三個參數給回應物件 → 取 msg；沒有 msg 取 error（後端外層 catch 只回 error）', () => {
  withDom(({ parent }) => {
    BC.markRefreshFail('hr-pending', null, { ok: false, reason: 'line_upstream', msg: '身分服務壞了' });
    assert.match(parent.kids[0].textContent, /身分服務壞了$/);
    BC.markRefreshFail('hr-pending', null, { ok: false, error: 'TypeError: x' });
    assert.match(parent.kids[0].textContent, /TypeError: x$/);
  });
});

/* ── ③ settleRefresh：取代全站 `if(ok)畫; else if(!cached)畫;` 的那一支 ───── */

test('settleRefresh：成功 → 回 true（照畫）並拿掉提示', () => {
  withDom(({ parent }) => {
    BC.markRefreshFail('hr-pending', null, 'x');
    assert.equal(BC.settleRefresh('hr-pending', { ok: true }, { savedAt: 1 }), true);
    assert.equal(parent.kids.length, 1);
  });
});

test('🔴 settleRefresh：失敗＋畫面上是快取 → 回 false（不准畫）並掛提示（含時間與 msg）', () => {
  withDom(({ parent, box }) => {
    const at = new Date(2026, 8, 12, 18, 30).getTime();
    assert.equal(BC.settleRefresh('hr-pending', { ok: false, msg: '無法確認身分' }, { savedAt: at }), false);
    assert.equal(parent.kids[0].textContent, '⚠️ 這裡顯示的是 9/12 18:30 的資料，目前無法更新：無法確認身分');
    assert.equal(box.innerHTML, '<div class="card">舊清單</div>');
  });
});

test('settleRefresh：取不到（回應是 undefined）也算失敗', () => {
  withDom(({ parent }) => {
    assert.equal(BC.settleRefresh('hr-pending', undefined, { savedAt: null }), false);
    assert.match(parent.kids[0].textContent, /先前的資料，目前無法更新：伺服器沒有回原因$/);
  });
});

test('⬛ 對照組 settleRefresh：失敗＋沒有快取 → 回 true（呼叫端畫錯誤框），且不留提示', () => {
  withDom(({ parent }) => {
    BC.markRefreshFail('hr-pending', null, '上一輪的');
    assert.equal(BC.settleRefresh('hr-pending', { ok: false, msg: 'x' }, null), true);
    assert.equal(parent.kids.length, 1, '錯誤框與「停在快取」提示同時出現');
  });
});

test('⬛ 對照組：區塊不存在時兩支都安靜略過（不在 body 上亂插）', () => {
  withDom(({ parent }) => {
    BC.markRefreshFail('no-such-box', null, 'x');
    BC.clearRefreshFail('no-such-box');
    assert.equal(parent.kids.length, 1);
  });
});
