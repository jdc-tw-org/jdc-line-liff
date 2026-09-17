/**
 * 這個 repo 是純靜態站（無建置）。webServer 起一個最小的 http server 服務 repo 根目錄，
 * 讓 spec 用相對路徑開頁面——**不要去打線上的 Pages**（那是正式站，而且會驗到舊版）。
 *
 * ══ 多棵工作樹同時跑 ══════════════════════════════════════════════════
 *
 * 這個 repo 常有十幾棵工作樹同時在跑 e2e，而**預設的 4173 是大家共用的號碼**。
 * 自己那一棵要跑之前先挑一個沒人在用的：
 *
 *     E2E_PORT=4291 npx playwright test
 *
 * 下面的 `baseURL` 與 `webServer.url` **兩格都**從 `tests/e2e/port.js` 取，
 * 與 `serve.js` 同一個來源。⚠️ 只改其中一格會留下一個不一致的洞——
 * 伺服器起在新 port、瀏覽器卻還是去敲 4173（敲到別人的樹，或誰都沒有）。
 *
 * 🔴 **撞 port 的失敗長得跟「測試抓到東西」一模一樣。** 實測過的兩種：
 *    `✘ 0 / exit=1`（port 被佔住、一條都沒跑）與
 *    `✘ 115 / exit=1`（server 被外力砍掉、每條都 ERR_CONNECTION_REFUSED）。
 *    ⇒ **`✘` 的數字對這一型零鑑別力**，要看的是退出碼與最後幾行。
 *
 * 🔴 **暫存工具一律放自己的工作樹底下，不要用共用暫存目錄的無限定檔名。**
 *    `isolation: worktree` 只隔離 git 工作樹，**不隔離共用的暫存目錄**
 *    ——兩軌各寫一支同名的 `scratchpad/mutate.py` 就會互相覆蓋，於是執行還原時
 *    跑到的是對方的腳本、把對方的 pristine 複製回對方的工作樹。
 *    **兩邊都不會有任何錯誤訊息。**
 */
const { ORIGIN } = require('./tests/e2e/port');

module.exports = {
  testDir: './tests/e2e',
  timeout: 30000,
  fullyParallel: false,          // 這批測試共用 route 攔截與計數器，平行會互相污染
  use: { baseURL: ORIGIN },
  // 🔴 用 `channel: 'chrome'`（真的 Google Chrome）而不是 Playwright 自帶的 Chromium。
  //    兩個理由：
  //    ① **更接近真實**——承辦人用的是公司 Windows 上的 Chrome，不是 Chromium。
  //    ② 本機 2026-08-29 實測 Playwright 的 chromium 下載連續三次卡住（CDN 連得到、
  //       目錄零成長、CPU 16 分鐘只用掉 1 秒），而系統 Chrome 本來就在。
  //    ⚠️ CI 要跟著改成 `npx playwright install --with-deps chrome`，
  //       裝 chromium 是**不夠的**——channel 指定的是另一個東西。
  projects: [{ name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } }],
  webServer: {
    // 零相依的自製 server。`npx --yes http-server` 第一次要下載套件，
    // 本機實測會卡在那裡（測試永遠不開始，而且沒有任何輸出）。
    command: 'node tests/e2e/serve.js',
    url: ORIGIN + '/line.html',
    // 🔴 **刻意不 reuse。** 2026-08-23 踩過：port 被另一個 session 的伺服器佔住，
    //    自己的 server 沒 bind 就死了，瀏覽器連到對方工作樹的檔案
    //    ——受測物是別人的檔案，而測試照樣有結果。
    //
    // 逃生口：`E2E_REUSE=1` 時才 reuse。**只有突變批次會設它**——連跑十幾次的話
    // 每次都重啟 server 會撞上 port 還沒釋放（2026-08-29 實測：16 個突變有 7 個
    // 因此整個跳過，而另外幾個是 Playwright 在啟動階段就錯誤退出、一條測試都沒跑，
    // 症狀是「紅 0 條」——看起來像測試沒抓到，其實是根本沒執行）。
    // 設了它的那一方**必須自己驗證 server 服務的是自己的工作樹**，否則就退回
    // 上面那個 2026-08-23 的坑。
    reuseExistingServer: !!process.env.E2E_REUSE,
    timeout: 60000,
  },
};
