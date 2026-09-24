/**
 * 手動測試頁的輸出目錄與 assets 連結——**每一棵工作樹各自一份**。
 *
 * 為何存在（jdc-tw-org/jdc-line-gas#128，2026-09-17）：
 * 這幾支原本把輸出目錄寫成 `os.tmpdir()/<固定名字>-ui`，**那個名字跨工作樹共用**；
 * 而 assets 連結只在「不存在時」才建（`if (!fs.existsSync(link))`）
 * ⇒ 第二棵樹產出的測試頁會**靜默沿用第一棵樹的 assets**：
 *   人看到的是自己的 HTML 配別人的 JS/CSS，**零錯誤訊息、畫面完全正常**。
 *   它讓「我開頁面看過了」這句話失效，而那正是本專案驗收 UI 的唯一手段。
 *
 * 兩道各自獨立、各自擋得住一種情境的防線（缺一就有一種情境沒人守）：
 *   1. `manualOutDir()`：預設輸出目錄帶**這棵樹的指紋** ⇒ 兩棵樹的預設目錄不同名。
 *      擋的是「兩棵樹都不給參數」——彼此的 HTML 不再互相覆蓋。
 *   2. `linkAssets()`：連結**每次都驗它指到哪裡**，不是本樹就砍掉重建。
 *      擋的是「兩棵樹被指定同一個輸出目錄」（第 1 道在這個情境下被繞過）。
 *
 * 指紋用工作樹的真實路徑（realpathSync）算，所以同一棵樹每次跑都拿到同一個目錄
 * ——印出來的 `cd <目錄> && python3 -m http.server <port>` 仍然可以重複貼。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/** 從 tests/manual/ 往上兩層＝這棵工作樹的根；realpath 讓 /tmp 與 /private/tmp 算同一棵。 */
function repoRootOf(startDir) {
  return fs.realpathSync(path.resolve(startDir, '..', '..'));
}

/** 這棵工作樹專屬的輸出目錄，例如 msg-ui-3f2a9c11。 */
function manualOutDir(name, repoRoot) {
  const id = crypto.createHash('sha1').update(repoRoot).digest('hex').slice(0, 8);
  return path.join(os.tmpdir(), name + '-' + id);
}

/**
 * 讓 <outDir>/assets 指向**這棵樹**的 assets/。
 * 已經存在不代表可以沿用——要嘛驗到它就是本樹、要嘛砍掉重建。
 * 順帶修掉一個原寫法的地雷：`fs.existsSync()` 對**斷掉的 symlink** 回 false，
 * 於是原本那行會走進 `symlinkSync` 然後炸 EEXIST。這裡改用 lstat。
 */
function linkAssets(outDir, repoRoot) {
  const link = path.join(outDir, 'assets');
  const want = fs.realpathSync(path.join(repoRoot, 'assets'));
  let st = null;
  try { st = fs.lstatSync(link); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let have = null;
  if (st && st.isSymbolicLink()) {
    try { have = fs.realpathSync(link); } catch (e) { have = null; }  // 斷掉的連結
  }
  if (st && have === want) return { link, target: want, reused: true };
  if (st) fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(want, link, 'dir');
  return { link, target: want, reused: false };
}

module.exports = { repoRootOf, manualOutDir, linkAssets };
