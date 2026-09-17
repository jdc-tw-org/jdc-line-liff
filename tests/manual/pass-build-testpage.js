/**
 * 產生「我的報到碼」通行證頁的 UI 驗收測試頁 pass-test.html
 * （輸出目錄由 outdir.js 給，**每一棵工作樹各自一份**）。
 *
 * 手法沿用 veg-build-testpage.js：把 index.html 原封複製，只在最前面插一段 script
 * 覆寫 window.fetch 與 window.liff，讓頁面走完自己的啟動流程（inline script 完整執行、
 * 事件照綁），所以語法錯誤、初始化早退、CSS 破版都還驗得到。**只換網路層與 LIFF SDK，不碰 DOM。**
 *
 * 為什麼要驗：通行證頁是 CSS×JS 交界最重的一頁——64px 大字桌號、「主桌」時要收掉「桌」字、
 * 沒有桌次時整區不出現。這三條都不是單元測試看得到的（2026-07-27 attend.html 下拉不隱藏的教訓）。
 *
 * 用法：node tests/manual/pass-build-testpage.js
 *      （輸出目錄與接下來要貼的指令，由這支自己印出來——不要憑記憶打 /tmp/pass-ui）
 *
 * 用 ?case=<名稱> 切換情境：numeric（預設）｜word｜notable｜noact
 * 產物全在 <tmpdir>/pass-ui-<這棵樹的指紋>/（repo 一個檔都不多），assets 走 symlink 指回**本樹**。
 * 為什麼要 http 不用 file://：playwright MCP 擋 file: 協定。
 */
const fs = require('fs');
const path = require('path');
const outdir = require('./outdir.js');

const ACT = { name: '2026 年中聚餐', eventDate: '2026/08/28' };

const CASES = {
  // 數字桌號：大字 64px ＋ 後面接「桌」
  numeric:  { ok: true, code: 'CHK|demoAct|00011|sigX', actId: 'demoAct',
              name: '喻小宇', table: '21', published: true, activity: ACT },
  // 非數字桌號：「主桌」後面不可以再接一個「桌」字
  word:     { ok: true, code: 'CHK|demoAct|00012|sigY', actId: 'demoAct',
              name: '俞小美', table: '主桌', published: true, activity: ACT },
  // 桌次未發布：整區不出現，不留「未定」佔位
  notable:  { ok: true, code: 'CHK|demoAct|00013|sigZ', actId: 'demoAct',
              name: '丁小瑞', table: null, published: false, activity: ACT },
  // 伺服器挑不到場次
  noact:    { ok: false, msg: '目前沒有可報到的活動。' },
};

const STUB = `<script>
(function () {
  var CASES = ${JSON.stringify(CASES)};
  var which = new URLSearchParams(location.search).get('case') || 'numeric';
  // LIFF SDK 樁：直接當成已登入，回一個固定 userId
  window.liff = {
    init: function () { return Promise.resolve(); },
    isLoggedIn: function () { return true; },
    login: function () {},
    getProfile: function () { return Promise.resolve({ userId: 'Udemo', displayName: '測試' }); },
    getFriendship: function () { return Promise.resolve({ friendFlag: true }); },
    openWindow: function () {}
  };
  var REPLY = {
    getEventCheckinPass: CASES[which],
    getMyLottery: { ok: true, enabled: false },   // 年中不啟用獎金卡
    getBindingState: { ok: true, bound: true },
    getInit: { ok: true, units: [], names: [] }
  };
  var realFetch = window.fetch;
  window.fetch = function (url) {
    var m = String(url).match(/[?&]action=([^&]+)/);
    var act = m ? decodeURIComponent(m[1]) : '';
    var cbm = String(url).match(/[?&]callback=([^&]+)/);
    var cb = cbm ? decodeURIComponent(cbm[1]) : 'cb';
    if (!(act in REPLY)) return realFetch.apply(this, arguments);
    var body = cb + '(' + JSON.stringify(REPLY[act]) + ')';
    return Promise.resolve(new Response(body, { status: 200 }));
  };
})();
</script>
`;

// 目錄名帶「這棵工作樹」的指紋、連結每次都驗指向——理由見 outdir.js（#128）。
// 原本寫死 '/tmp/pass-ui'：assets 每次砍掉重建所以不會沿用別人的，
// 但**目錄本身跨工作樹共用** ⇒ 兩棵樹輪流產出會互相覆蓋 pass-test.html，一樣零錯誤訊息。
const REPO = outdir.repoRootOf(__dirname);
const OUT = outdir.manualOutDir('pass-ui', REPO);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const src = path.join(__dirname, '..', '..', 'index.html');
let html = fs.readFileSync(src, 'utf8');
// ⚠️ 樁必須**取代** LIFF SDK 那一行，不能只插在 <head> 開頭——SDK 是外部 script，
// 載入時機在後，會把 window.liff 蓋回真貨，然後真的跳去 LINE 登入頁（實際踩過）。
const SDK = /<script src="https:\/\/static\.line-scdn\.net\/liff\/edge\/2\/sdk\.js"><\/script>/;
if (!SDK.test(html)) throw new Error('找不到 LIFF SDK 的 script 標籤——index.html 結構變了，樁會失效，先修這裡');
html = html.replace(SDK, STUB);
fs.writeFileSync(path.join(OUT, 'pass-test.html'), html);
const assets = outdir.linkAssets(OUT, REPO);

console.log('已產生 ' + path.join(OUT, 'pass-test.html'));
/* 把「這一頁配的是誰的 assets」印到眼前：#128 的病灶就是這件事沒有人看得見。 */
console.log('assets → ' + assets.target + (assets.reused ? '（沿用既有連結，已驗證是本工作樹）' : ''));
console.log('情境：' + Object.keys(CASES).join(' / '));
console.log('cd ' + OUT + ' && python3 -m http.server 8898');
console.log('開 http://localhost:8898/pass-test.html?mode=pass&act=demoAct&case=numeric');
