/**
 * `assets/ui.css` 是全站語彙的唯一副本——**但有兩頁不 `<link>` 它**：
 *
 *   · `staff.html`（報到掃描）  滿版相機介面，`ui.css` 的 `body{max-width:480px}` 會壓垮它
 *   · `wall.html`（進場狀況）    整個視窗的投影牆，同上
 *
 * 兩頁各自帶著一份淺色色票副本。**副本會分歧，而分歧沒有任何錯誤訊息**
 * （`feedback_same_judgment_scattered`：修法都是對的，錯的是「符合條件的地方有哪些」沒被列出來）。
 * 這一支就是那個「要求它們相等」的東西。
 *
 * 🔴 **它釘的是「值相等」，不是「名字相同」。** 兩頁的變數名是自己的
 * （`--ok-fg`／`--er-bg`…），對照表在下面 `對照` 裡逐格寫死——
 * 因為那正是人要做的判斷：這一格對應共用語彙的哪一個角色。
 *
 * ⏳ 退場條件：哪一天 `ui.css` 的 `body` 規則不再與滿版版面衝突
 * （例如版面搬進 `.wrap` 之類的容器），這兩頁就能直接 `<link>`，本檔連同兩份副本一起刪。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const 根 = path.join(__dirname, '..');
const 讀 = (f) => fs.readFileSync(path.join(根, f), 'utf8');

/** 取某個檔裡第一個 `:root{…}` 區塊的變數表。**只取第一個**＝淺色那一份。 */
function 淺色變數(src) {
  const m = src.match(/:root\s*\{([^}]*)\}/);
  assert.ok(m, '找不到 :root 區塊——量法壞了，不是檔案壞了');
  const out = {};
  for (const line of m[1].split(';')) {
    const kv = line.match(/(--[a-z0-9-]+)\s*:\s*([^;]+)/i);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

const ui = 淺色變數(讀('assets/ui.css'));

/** 每一格＝「這一頁的這個名字，扮演共用語彙裡的哪個角色」。 */
const 對照 = {
  'staff.html': {
    '--bg': '--bg', '--line': '--ln', '--ink': '--ink', '--txt': '--ink',
    '--mut': '--ink2', '--faint': '--ink3',
    '--ok-bg': '--g-bg', '--ok-fg': '--g',
    '--wa-bg': '--warn-bg', '--wa-fg': '--warn',
    '--er-bg': '--r-bg', '--er-fg': '--r-dim',
    '--primary': '--b',
  },
  'wall.html': {
    '--bg': '--bg', '--ink': '--ink', '--ink2': '--ink2', '--ink3': '--ink3',
    '--r': '--r',
  },
};

for (const [頁, 表] of Object.entries(對照)) {
  test(`${頁} 的淺色色票要與 assets/ui.css 逐格相同`, () => {
    const 本頁 = 淺色變數(讀(頁));
    for (const [這邊, 那邊] of Object.entries(表)) {
      assert.ok(這邊 in 本頁, `${頁} 少了 ${這邊}——是改名了還是刪了？對照表要跟著改`);
      assert.ok(那邊 in ui, `ui.css 少了 ${那邊}——對照表指向一個不存在的角色`);
      assert.strictEqual(本頁[這邊], ui[那邊],
        `${頁} 的 ${這邊} 是 ${本頁[這邊]}，而 ui.css 的 ${那邊} 是 ${ui[那邊]}。\n` +
        '這兩份是同一個語彙的兩份副本，改一邊要改兩邊（本檔檔頭寫了為何不能直接 link）。');
    }
  });
}

test('⬛ 對照組：量法真的分得出「不相等」', () => {
  const 假 = 淺色變數(':root{ --bg:#000000; }');
  assert.notStrictEqual(假['--bg'], ui['--bg'],
    '拿一個一定不同的值來比竟然相等 ⇒ 上面那幾條測試零鑑別力');
  assert.strictEqual(Object.keys(淺色變數(讀('assets/ui.css'))).length > 10, true,
    'ui.css 只解析出個位數的變數 ⇒ 正規表示式沒吃到整個區塊');
});
