/**
 * 獎金卡（`index.html?mode=pass`）刷新失敗時，畫面要說話（`#82`）。
 *
 * ══ 為何存在 ═══════════════════════════════════════════════════════════
 *
 * `loadLottery` 是教科書形狀的 SWR：先讀 `sessionStorage` 把上一次的獎金卡畫出來，
 * 再打 `getMyLottery` 校正。修之前，那個「校正」的**兩條失敗分支都不碰畫面**——
 * 一條 `return`、一條只寫 `?diag=1` 才看得到的飛行紀錄。
 * ⇒ 伺服器壞掉時，同仁看到的是**上一次的中獎金額**，而畫面一個字都不說。
 *
 * ⬛ **零點（修之前實跑，不是推論）**：本檔前兩條測試在 `origin/main fa18c12` 上是紅的，
 *    截圖 `82-zero-*.png` 裡整張獎金卡照常顯示、沒有任何提示。
 *
 * ══ ⚠️ 這支測的是「有快取才說話」，不是「失敗就喊」════════════════════════
 *
 * 獎金卡是加值不是主功能（原檔頭：雙 gate，非尾牙或未報到＝整區不出現）。
 * 🔴 **沒有快取時失敗仍要安靜**——那一格本來就不該出現任何東西，憑空冒出一則錯誤
 * 是新的噪音，不是可見性。所以「安靜」那條也要有測試釘著，否則修這個洞的人
 * 很容易把它修成「一律喊」，而那在畫面上看起來也很像修好了。
 *
 * ⚠️ 還有一條容易寫反的：`ok:true` 但 `enabled:false`／`checkedIn:false` 是
 * **合法的「這區不該出現」**，不是失敗。把它算成失敗 ⇒ 沒報到的人會看到
 * 「資料可能不是最新的」。
 */
const { test, expect } = require('@playwright/test');
const path = require('node:path');

// ⚠️ 預設落在 `test-results/`——那個目錄 `.gitignore` 已經有了。
//    這個 repo 是 PUBLIC 而且根目錄就是 Pages 站台，別另開一個沒被忽略的目錄。
const SHOTS = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'test-results', 'shots');

const UID = 'U_e2e_lottery_82';
const ACT = 'yearend2026';

/** 快取住的那份獎金卡（畫面上看得到的東西）。 */
const 快取獎金卡 = {
  ok: true, enabled: true, checkedIn: true,
  wins: 2, rank: 5, total: 12000, pendingTotal: 4000,
  rounds: [{ round: '第一輪', amount: 8000, status: '已領獎' },
           { round: '第三輪', amount: 4000, status: '待確認' }],
};

/** 真 SDK 在 localhost 上必失敗並把整頁導走；替身要早於頁面 script。 */
function liff替身(uid) {
  window.liff = {
    init: () => Promise.resolve(),
    isLoggedIn: () => true,
    getProfile: () => Promise.resolve({ userId: uid, displayName: '測試員' }),
    login: () => {}, logout: () => {}, closeWindow: () => {}, openWindow: () => {},
    getOS: () => 'ios', isInClient: () => true, getVersion: () => '2.0.0',
  };
}

/**
 * 掛好儀器再開頁面。**`route` 與 `addInitScript` 一律早於 `goto`**。
 *
 * @param {object} opt
 * @param {boolean} opt.seedCard  要不要先種一張快取獎金卡（＝畫面上有東西可以停住）
 * @param {object|'abort'} opt.lotteryResp  `getMyLottery` 回什麼；'abort' ＝傳輸失敗
 */
async function 開通行證(page, opt) {
  await page.setViewportSize({ width: 390, height: 844 });   // 手機，這一頁只在手機上看
  await page.route(/static\.line-scdn\.net/, (r) => r.abort('failed'));
  await page.route(/script\.google\.com/, (r) => {
    const url = r.request().url();
    // 這一條路徑只會打 getMyLottery（通行證本身命中快取＝0 次 GAS）。
    // ⚠️ 打到別支就是受測路徑跟我以為的不一樣 ⇒ 回一個會讓斷言指得出來的東西。
    if (url.indexOf('action=getMyLottery') < 0) {
      return r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
        body: 'cb(' + JSON.stringify({ ok: false, msg: '__非預期的 action：' + url + '__' }) + ')' });
    }
    if (opt.lotteryResp === 'abort') return r.abort('failed');
    return r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
      body: 'cb(' + JSON.stringify(opt.lotteryResp) + ')' });
  });
  await page.addInitScript(liff替身, UID);
  await page.addInitScript(([uid, act, card, seed]) => {
    // 通行證快取：命中 ⇒ startPass 一次 GAS 都不打，直接 renderPass + loadLottery
    localStorage.setItem('jdcPass:v3:' + uid + ':auto', JSON.stringify({
      v: '',
      res: { ok: true, published: true, code: 'CHK2|' + act + '|E2E|sig', name: '測試員', table: '8',
             actId: act, activity: { name: '2026 尾牙', eventDate: '2099/01/01' } },
    }));
    if (seed) sessionStorage.setItem('lottery_' + uid + '_' + act, JSON.stringify(card));
  }, [UID, ACT, 快取獎金卡, !!opt.seedCard]);
  await page.goto('/index.html?mode=pass', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#section-pass')).toBeVisible({ timeout: 15000 });
}

/** 畫面上「獎金卡可能不是最新」那句話。⚠️ 用語意（role=status）不用文案字串比對。 */
const 提示 = '#pass-lottery-warn';

test('★零點　有快取獎金卡 + getMyLottery 回 ok:false ⇒ 畫面必須說話，而且獎金卡還在', async ({ page }) => {
  await 開通行證(page, { seedCard: true, lotteryResp: { ok: false, msg: '伺服器忙碌中，請稍後再試' } });
  // 先確認「畫面上真的有一張快取畫出來的獎金卡」——沒有的話這一輪什麼都沒測到
  await expect(page.locator('#pass-lottery')).toBeVisible();
  await expect(page.locator('#pass-lottery')).toContainText('12,000');
  await expect(page.locator(提示)).toBeVisible({ timeout: 10000 });
  // 🔴 SWR 不可以變成「失敗就清空」：快取的獎金卡必須還在
  await expect(page.locator('#pass-lottery')).toContainText('12,000');
  // 後端原文要逐字帶出來，否則同仁與承辦人都不知道發生什麼事
  await expect(page.locator(提示)).toContainText('伺服器忙碌中，請稍後再試');
  await page.screenshot({ path: path.join(SHOTS, '82-after-okfalse.png'), fullPage: true });
});

test('★零點　有快取獎金卡 + 傳輸失敗（.catch 那條）⇒ 一樣要說話', async ({ page }) => {
  await 開通行證(page, { seedCard: true, lotteryResp: 'abort' });
  await expect(page.locator('#pass-lottery')).toContainText('12,000');
  await expect(page.locator(提示)).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#pass-lottery')).toContainText('12,000');
  await page.screenshot({ path: path.join(SHOTS, '82-after-abort.png'), fullPage: true });
});

test('★對照組　成功 ⇒ 提示不該出現（而且卡片換成新的）', async ({ page }) => {
  await 開通行證(page, { seedCard: true, lotteryResp: {
    ok: true, enabled: true, checkedIn: true, wins: 3, rank: 2, total: 30000, pendingTotal: 0,
    rounds: [{ round: '第五輪', amount: 30000, status: '已領獎' }],
  } });
  await expect(page.locator('#pass-lottery')).toContainText('30,000', { timeout: 10000 });
  await expect(page.locator(提示)).toBeHidden();
});

test('★對照組　沒有快取卡 + 失敗 ⇒ 仍然安靜（獎金卡是加值，整區不該冒出來）', async ({ page }) => {
  await 開通行證(page, { seedCard: false, lotteryResp: { ok: false, msg: '伺服器忙碌中' } });
  await expect(page.locator('#pass-qr')).toBeVisible();          // 頁面真的走完了
  await page.waitForTimeout(1200);                                // 給它時間出錯
  await expect(page.locator('#pass-lottery')).toBeHidden();
  await expect(page.locator(提示)).toBeHidden();
});

/**
 * ⚠️ 這條刻意**帶著快取卡**跑。不帶卡的話「只有畫面上有卡才說話」那道守衛會先攔下來，
 *    於是把這一格寫反（把合法狀態算成失敗）也照樣是綠的——那就什麼都沒測到。
 */
test('★對照組　ok:true 但未報到（checkedIn:false）＝合法的「這區不出現」，不是失敗', async ({ page }) => {
  await 開通行證(page, { seedCard: true, lotteryResp: { ok: true, enabled: true, checkedIn: false } });
  await expect(page.locator('#pass-lottery')).toContainText('12,000');
  await page.waitForTimeout(1200);
  await expect(page.locator(提示)).toBeHidden();
});
