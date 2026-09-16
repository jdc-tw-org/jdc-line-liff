/**
 * version-probe.js — 「我現在看到的這份畫面，是哪一版、卡在哪裡」的量測。
 *
 * ══ 為何存在 ══════════════════════════════════════════════════════════
 *
 * 症狀是**間歇的**：開頁時資料沒載入、或停在舊狀態；按「抓最新版」或重新
 * 進入之後就正常。沒有穩定重現，所以**先做量法，不猜位置去改**。
 *
 * 🔴 **「按了抓最新版就好」不是版本問題的證據。** `page-version.js` 的
 *    `refresh()` 最後一行是 `location.reload()` ⇒ 按它與「重新進入」在結果上
 *    無法分辨。要分辨，得在**還沒重載之前**就看到三件事：
 *      ① 瀏覽器手上這份 HTML／JS，跟伺服器上的那份是不是同一版；
 *      ② 開頁那幾條初始化的 Promise，哪一條還沒有結果；
 *      ③ 讀取佇列（同頁最多一支請求在飛的那條）還轉不轉得動。
 *    ②③ 只有**在當下**問得到——重載一次，證據就沒了。
 *
 * ⚠️ **本檔不送任何 /exec 請求**，只重抓同源靜態檔、只排一個立刻結束的空工作。
 * ⚠️ **本 repo 為 PUBLIC。** 報告輸出經過白名單：只留 action 名、時間、位元組數、
 *    雜湊。網址上的授權字串、回應內容、任何人名，**結構上不會進到輸出**
 *    （見 `redactExec`：它是重建一個新字串，不是從原字串刪東西）。
 *
 * 掛法（各頁自己決定要不要掛，本檔不自動啟動）：
 *     <script src="assets/version-probe.js"></script>
 *     JDCProbe.track('AUTH_READY', AUTH_READY);   // 想看狀態的 Promise
 *     JDCProbe.mount({ gasUrl: GAS_URL, queueRead: queueRead });
 *
 * 判讀（三種世界，輸出長得不一樣）：
 *   · 資源「🔴 不同版」  → 真的混到不同部署版本，該治的是快取／部署
 *   · 佇列「🔴 卡住」    → 有一支排進去的讀取永遠不結束，後面全部靜默不送
 *   · 兩者都正常而畫面空 → 不是版本也不是佇列，看 Promise 那段誰還「等待中」
 */
(function (root) {
  'use strict';

  /** 等佇列多久算卡住。GAS 一趟實測 1.7–2.1 秒，留三倍。 */
  var QUEUE_WAIT_MS = 6000;

  /* ══ 純函式（可在 node 測）══════════════════════════════════════════ */

  /**
   * 32 位元內容指紋。**不是密碼學雜湊**，只用來回答「這兩份位元組一不一樣」。
   * 不用 crypto.subtle：那支是非同步的、且在非安全來源不存在，而這支要能在
   * 任何情況下跑出一個值——量測工具自己壞掉卻不出聲，是最糟的一種。
   */
  function hash32(s) {
    var h = 5381, i;
    s = String(s == null ? '' : s);
    for (i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return ('0000000' + h.toString(16)).slice(-8);
  }

  /**
   * /exec 的網址 → 可以印出來的一行。**重建，不是過濾。**
   *
   * 🔴 用「刪掉 token 參數」寫的話，日後後端多一個帶身分的參數名，這支會靜靜地
   *    把它印出來。這裡反過來：只認得 `action`（與 batch 的 `list` 裡的 `a`），
   *    其餘一律不存在於輸出裡。認不得就回 null。
   * @returns {?string} 例：`batch[listActivities,getActivityStats]`
   */
  function redactExec(url) {
    var qi = String(url == null ? '' : url).indexOf('?');
    if (qi < 0) return null;
    var action = '', list = '';
    String(url).slice(qi + 1).split('&').forEach(function (kv) {
      var eq = kv.indexOf('=');
      var k = eq < 0 ? kv : kv.slice(0, eq);
      var v = eq < 0 ? '' : kv.slice(eq + 1);
      if (k === 'action') action = v;
      else if (k === 'list') list = v;
    });
    if (!action) return null;
    var safe = decodeURIComponent(action).replace(/[^A-Za-z0-9_]/g, '');
    if (!safe) return null;
    var subs = [];
    if (list) {
      try {
        JSON.parse(decodeURIComponent(list)).forEach(function (it) {
          var a = it && it.a ? String(it.a).replace(/[^A-Za-z0-9_]/g, '') : '';
          if (a) subs.push(a);
        });
      } catch (e) { subs = []; }
    }
    return safe + (subs.length ? '[' + subs.join(',') + ']' : '');
  }

  /**
   * 一列資源的判決。`cached`／`server` 是 {hash,bytes,lastModified,etag} 或 null。
   * 🔴 兩邊都取不到時回「量不到」，**不可以回「同版」**——那會讓一支壞掉的量法
   *    對所有輸入都印出「一切正常」，而壞掉的樣子跟正常一模一樣。
   */
  function classifyRow(row) {
    var c = row && row.cached, s = row && row.server;
    if (!c || !s || !c.hash || !s.hash) return '量不到';
    return c.hash === s.hash ? '同版' : '🔴 不同版';
  }

  /** 檔名（給輸出用；完整網址太長，手機上一行放不下）。 */
  function shortName(url) {
    var u = String(url == null ? '' : url).split('?')[0].split('#')[0];
    var seg = u.split('/');
    return seg[seg.length - 1] || u;
  }

  /**
   * 佇列還轉不轉得動：排一個「立刻結束」的空工作進去，看多久輪到它。
   *
   * 🔴 為何這樣量：`queueRead` 的失敗處理寫的是 `GAS_TAIL.then(fn, fn)`
   *    ——它接得住**被拒絕**的工作，接不住**永遠不結束**的工作。後者一旦發生，
   *    之後每一支排進去的讀取都不會執行，而且沒有任何錯誤訊息。
   *    排一個空工作進去，是唯一能從外面問出這件事的方法（不必改那支共用函式）。
   * ⚠️ 空工作本身回已 resolve 的 Promise ⇒ 量測不會變成新的塞車源。
   */
  function queueProbe(queueReadFn, waitMs, nowFn) {
    var now = nowFn || function () { return Date.now(); };
    var wait = waitMs || QUEUE_WAIT_MS;
    if (typeof queueReadFn !== 'function') {
      return Promise.resolve({ state: '量不到', ms: null, why: '這一頁沒有讀取佇列' });
    }
    var t0 = now(), ran = false;
    var job = new Promise(function (res) {
      try {
        queueReadFn(function () {
          ran = true;
          res({ state: '通暢', ms: Math.round(now() - t0), why: '' });
          return Promise.resolve();
        });
      } catch (e) {
        ran = true;
        res({ state: '量不到', ms: null, why: '排隊時丟例外' });
      }
    });
    var cap = new Promise(function (res) {
      setTimeout(function () {
        if (!ran) res({ state: '🔴 卡住', ms: Math.round(now() - t0), why: '排進去等了 ' + wait + 'ms 還沒輪到，前面有一支讀取永遠不結束' });
      }, wait);
    });
    return Promise.race([job, cap]);
  }

  /**
   * 追蹤一個 Promise 的狀態。
   * ⚠️ 一定要用兩個參數的 `then(f, f)`：只傳第一個參數的話，被追蹤的 Promise
   *    若是被拒絕的，這裡會**再生出一個沒人接的拒絕**——量測本身製造出新的錯誤。
   */
  function trackPromise(reg, name, p, nowFn) {
    var now = nowFn || function () { return Date.now(); };
    var t0 = now();
    var rec = { name: name, state: '等待中', ms: null };
    reg.push(rec);
    if (!p || typeof p.then !== 'function') { rec.state = '量不到'; return rec; }
    p.then(
      function () { rec.state = '已完成'; rec.ms = Math.round(now() - t0); },
      function () { rec.state = '🔴 失敗'; rec.ms = Math.round(now() - t0); }
    );
    return rec;
  }

  /**
   * 報告的文字化。純函式——輸出長什麼樣，在 node 裡就驗得到。
   *
   * 🔴 **最後一行是自檢（對照組）**：拿一組「已知相同」與一組「已知不同」餵給
   *    同一支 `classifyRow`，把兩個判決印在同一份輸出裡。那一行若讀起來不對，
   *    上面整份報告都不可信——沒有它，「全部同版」這句話有可能整串是假的。
   */
  function renderReport(m) {
    var L = [];
    L.push('── 版本 ─────────────────────────────');
    var bad = (m.rows || []).filter(function (r) { return r.verdict === '🔴 不同版'; });
    var unk = (m.rows || []).filter(function (r) { return r.verdict === '量不到'; });
    L.push('資源 ' + (m.rows || []).length + ' 支：同版 ' + ((m.rows || []).length - bad.length - unk.length)
      + '、不同版 ' + bad.length + '、量不到 ' + unk.length);
    (m.rows || []).forEach(function (r) {
      // 頁面本身永遠列出來（它是版本的錨），其餘只列有問題的——手機上一行都是成本
      if (r.isDoc || r.verdict !== '同版') {
        L.push('  ' + r.verdict + ' ' + r.name
          + ' 手上=' + ((r.cached && r.cached.hash) || '?')
          + ' 伺服器=' + ((r.server && r.server.hash) || '?')
          + (r.fromCache == null ? '' : (r.fromCache ? ' [開頁時取自快取]' : ' [開頁時走網路]')));
      }
    });
    L.push('HTML 的 Last-Modified：' + (m.docLastModified || '🔴 伺服器沒送'
      + '（document.lastModified 會退回「現在」，那個值不可以當版本用）'));

    L.push('── 後端 ─────────────────────────────');
    L.push('部署指紋 ' + (m.gasFingerprint || '量不到') + '（這份 HTML 在跟哪一條 /exec 說話）');
    L.push('🔴 回應本身沒有版本欄位 ⇒「API 回應版本」目前量不到，只能量到上面這條與下面的形狀');
    if (!(m.calls || []).length) L.push('  本次開頁沒有已完成的 /exec（全部還在飛，或一支都沒送）');
    (m.calls || []).forEach(function (c) {
      L.push('  ' + c.action + ' 耗時 ' + c.ms + 'ms 完成於開頁後 ' + c.endedAt + 'ms');
    });

    L.push('── 初始化時序 ───────────────────────');
    (m.promises || []).forEach(function (p) {
      L.push('  ' + p.name + '：' + p.state + (p.ms == null ? '' : ' (' + p.ms + 'ms)'));
    });
    L.push('  讀取佇列：' + m.queue.state + (m.queue.ms == null ? '' : ' (' + m.queue.ms + 'ms)')
      + (m.queue.why ? ' — ' + m.queue.why : ''));

    L.push('── 自檢（對照組）─────────────────────');
    var same = classifyRow({ cached: { hash: 'aaaaaaaa' }, server: { hash: 'aaaaaaaa' } });
    var diff = classifyRow({ cached: { hash: 'aaaaaaaa' }, server: { hash: 'bbbbbbbb' } });
    var none = classifyRow({ cached: null, server: { hash: 'bbbbbbbb' } });
    L.push('  已知同版→' + same + '／已知不同版→' + diff + '／取不到→' + none);
    L.push('  這一行若不是「同版／🔴 不同版／量不到」，上面整份報告都不可信');
    L.push('量測時刻 ' + m.at + '（開頁後 ' + m.sincePageStart + 'ms）');
    return L.join('\n');
  }

  /* ══ 瀏覽器側 ══════════════════════════════════════════════════════ */

  var _promises = [];
  var _t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  function _now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  function track(name, p) { return trackPromise(_promises, name, p, _now); }

  /** 同源的 HTML／JS／CSS 清單。跨來源的抓不到內容，也不是我們部署的，不列。 */
  function sameOriginUrls() {
    var out = [location.href.split('#')[0]];
    var nodes = document.querySelectorAll('script[src], link[rel="stylesheet"][href]');
    for (var i = 0; i < nodes.length; i++) {
      var u = nodes[i].src || nodes[i].href;
      if (u && u.indexOf(location.origin) === 0 && out.indexOf(u) < 0) out.push(u);
    }
    return out;
  }

  /**
   * 抓一份並取指紋。
   * `force-cache` ＝瀏覽器手上那份（新鮮就完全不連網）；`no-store` ＝伺服器現在那份，
   * 且**不寫回快取**——量測不可以順手改掉被量的東西（`reload` 會覆寫，那是「抓最新版」在做的事）。
   */
  function grab(url, mode) {
    return fetch(url, { cache: mode, credentials: 'omit' }).then(function (r) {
      if (!r.ok) return null;
      return r.text().then(function (t) {
        return {
          hash: hash32(t), bytes: t.length,
          lastModified: r.headers.get('last-modified') || '',
          etag: r.headers.get('etag') || ''
        };
      });
    }).catch(function () { return null; });
  }

  /** 開頁時這支資源是不是取自快取（transferSize 為 0 而確實有內容＝沒連網）。 */
  function fromCache(url) {
    try {
      var e = performance.getEntriesByType('resource').filter(function (x) { return x.name === url; });
      if (!e.length) return null;
      var last = e[e.length - 1];
      if (typeof last.transferSize !== 'number' || typeof last.decodedBodySize !== 'number') return null;
      if (last.decodedBodySize === 0) return null;
      return last.transferSize === 0;
    } catch (err) { return null; }
  }

  /** 已完成的 /exec（還在飛的不會出現在這裡——那要看上面的 Promise 段）。 */
  function execCalls() {
    var out = [];
    try {
      performance.getEntriesByType('resource').forEach(function (e) {
        var a = redactExec(e.name);
        if (!a) return;
        out.push({ action: a, ms: Math.round(e.duration), endedAt: Math.round(e.responseEnd) });
      });
    } catch (err) { /* 沒有 resource timing 就少這一段，不影響其他段 */ }
    return out;
  }

  function collect(opts) {
    opts = opts || {};
    var urls = sameOriginUrls();
    var docUrl = urls[0];
    return Promise.all([
      Promise.all(urls.map(function (u) {
        return Promise.all([grab(u, 'force-cache'), grab(u, 'no-store')]).then(function (pair) {
          var row = {
            url: u, name: shortName(u), isDoc: u === docUrl,
            cached: pair[0], server: pair[1], fromCache: fromCache(u)
          };
          row.verdict = classifyRow(row);
          return row;
        });
      })),
      queueProbe(opts.queueRead, opts.queueWaitMs, _now)
    ]).then(function (r) {
      var rows = r[0];
      var doc = rows[0];
      return {
        rows: rows,
        docLastModified: (doc && doc.server && doc.server.lastModified) || '',
        gasFingerprint: opts.gasUrl ? hash32(opts.gasUrl) : '',
        calls: execCalls(),
        promises: _promises.slice(),
        queue: r[1],
        at: new Date().toLocaleString('zh-TW', { hour12: false }),
        sincePageStart: Math.round(_now() - _t0)
      };
    });
  }

  function report(opts) { return collect(opts).then(renderReport); }

  /**
   * 頁尾掛一個「診斷」連結。點了**不重載**——重載會把要量的東西洗掉。
   * ⚠️ 預設不展開、不發任何請求；沒點就跟沒有這支一樣。
   */
  function mount(opts) {
    opts = opts || {};
    if (document.getElementById('jdc-probe')) return;
    var wrap = document.createElement('div');
    wrap.id = 'jdc-probe';
    wrap.style.cssText = 'margin:0 0 14px;text-align:center;font-size:11px;color:var(--ink2,#9a938b)';
    var a = document.createElement('a');
    a.href = 'javascript:void 0';
    a.textContent = '診斷（版本與時序）';
    a.style.cssText = 'color:inherit;text-decoration:underline;cursor:pointer';
    var pre = document.createElement('pre');
    pre.id = 'jdc-probe-out';
    pre.hidden = true;
    pre.style.cssText = 'text-align:left;white-space:pre-wrap;word-break:break-all;font-size:11px;'
      + 'line-height:1.7;margin:10px auto 0;max-width:640px;padding:10px 12px;border:1px solid var(--ln,#ddd);'
      + 'border-radius:6px;background:#fbfaf8;color:#444;-webkit-user-select:text;user-select:text';
    var copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = '複製';
    copy.hidden = true;
    copy.style.cssText = 'margin-top:8px;font-size:11px;padding:4px 10px';
    copy.addEventListener('click', function () {
      var t = pre.textContent;
      // 手機上沒有 devtools，這份報告要出得了這台裝置才有用；剪貼簿被擋就退回全選
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(function () { copy.textContent = '已複製'; },
          function () { copy.textContent = '複製失敗，請長按選取'; });
      } else { copy.textContent = '請長按選取'; }
    });
    a.addEventListener('click', function (e) {
      e.preventDefault();
      if (!pre.hidden) { pre.hidden = true; copy.hidden = true; return; }
      pre.hidden = false; copy.hidden = false; copy.textContent = '複製';
      pre.textContent = '量測中…';
      report(opts).then(function (t) { pre.textContent = t; },
        function (err) { pre.textContent = '量測本身失敗：' + ((err && err.message) || String(err)); });
    });
    wrap.appendChild(a);
    wrap.appendChild(pre);
    wrap.appendChild(copy);
    document.body.appendChild(wrap);
  }

  var api = {
    hash32: hash32, redactExec: redactExec, classifyRow: classifyRow, shortName: shortName,
    queueProbe: queueProbe, trackPromise: trackPromise, renderReport: renderReport,
    track: track, collect: collect, report: report, mount: mount,
    QUEUE_WAIT_MS: QUEUE_WAIT_MS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JDCProbe = api;
})(typeof window !== 'undefined' ? window : this);
