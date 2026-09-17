const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * #128：手動測試頁的輸出目錄與 assets 連結，必須是「這一棵工作樹」的。
 *
 * 為何存在：原本輸出目錄是 `os.tmpdir()/<固定名字>-ui`（跨工作樹共用），
 * assets 連結又只在不存在時才建 ⇒ 第二棵樹的測試頁會**靜默**配上第一棵樹的 JS/CSS，
 * 畫面完全正常、零錯誤訊息，於是「我開頁面看過了」這句話失效。
 * 手動跑的東西沒人會再跑第二次，所以把兩道防線釘進 `npm test`。
 */
const { manualOutDir, linkAssets, repoRootOf } = require('./manual/outdir.js');

/** 造一棵假的工作樹：<tmp>/<name>/assets/MARK 內容就是它自己的名字。 */
function fakeTree(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outdir-' + name + '-'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', 'MARK'), name);
  return fs.realpathSync(root);
}

test('#128 防線一：兩棵工作樹的預設輸出目錄不同名，同一棵樹則每次都一樣', () => {
  const a = fakeTree('A'), b = fakeTree('B');
  assert.notStrictEqual(manualOutDir('msg-ui', a), manualOutDir('msg-ui', b),
    '兩棵樹拿到同一個輸出目錄——這正是彼此覆蓋產物的樣子');
  assert.strictEqual(manualOutDir('msg-ui', a), manualOutDir('msg-ui', a),
    '同一棵樹兩次算出不同目錄的話，印出來的 cd 指令就不能重複貼');
  assert.ok(manualOutDir('msg-ui', a).indexOf('msg-ui') > -1, '名字要看得出是哪一支產的');
});

test('#128 防線二：連結指向別棵樹時，必須改指本樹（不可以因為「已經有了」就沿用）', () => {
  const a = fakeTree('A'), b = fakeTree('B');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'outdir-shared-'));
  linkAssets(out, a);                      // 先跑的那一棵
  assert.strictEqual(fs.readFileSync(path.join(out, 'assets', 'MARK'), 'utf8'), 'A');

  const r = linkAssets(out, b);            // 後跑的那一棵，共用同一個輸出目錄
  assert.strictEqual(fs.readFileSync(path.join(out, 'assets', 'MARK'), 'utf8'), 'B',
    '第二棵樹讀到了第一棵樹的 assets——#128 本體，而且畫面上看不出來');
  assert.strictEqual(r.reused, false);
  assert.strictEqual(r.target, path.join(b, 'assets'));
});

test('#128：已經指向本樹的連結才可以沿用', () => {
  const a = fakeTree('A');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'outdir-same-'));
  linkAssets(out, a);
  const r = linkAssets(out, a);
  assert.strictEqual(r.reused, true, '同一棵樹重跑不必每次砍掉重建');
  assert.strictEqual(fs.readFileSync(path.join(out, 'assets', 'MARK'), 'utf8'), 'A');
});

test('#128：斷掉的 symlink 要被重建，不是炸 EEXIST', () => {
  // 原寫法的地雷：fs.existsSync() 對斷掉的連結回 false ⇒ 會走進 symlinkSync 然後炸。
  const a = fakeTree('A');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'outdir-dangling-'));
  fs.symlinkSync(path.join(out, 'nowhere'), path.join(out, 'assets'), 'dir');
  assert.strictEqual(fs.existsSync(path.join(out, 'assets')), false, '前提：existsSync 對斷鏈回 false');
  const r = linkAssets(out, a);
  assert.strictEqual(r.reused, false);
  assert.strictEqual(fs.readFileSync(path.join(out, 'assets', 'MARK'), 'utf8'), 'A');
});

test('#128：repoRootOf 從 tests/manual 往上兩層拿到工作樹根', () => {
  assert.strictEqual(repoRootOf(path.join(__dirname, 'manual')),
    fs.realpathSync(path.join(__dirname, '..')));
});
