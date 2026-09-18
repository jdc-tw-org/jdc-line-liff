# 認證盤點基準快照（兩格）

> 🔴 **這是快照，不是期望值表。** 它只說「跟上次比，變了沒有」，**不宣稱哪一格是對的**。
> 尤其第②格只是**第一道**門檻——第二道可以手寫在 handler 裡而不進任何清冊，
> 所以「這一頁有幾道門」今天仍然是推論。解除條件寫在 `tests/helpers/auth-scan.js` 的檔頭。

## 這份是怎麼來的

| | |
|---|---|
| 產生器 | `tests/helpers/auth-scan.js` |
| 詞法掃描 | `tests/helpers/action-scan.js` 的 `tokenize()`（**共用同一支**，不另寫） |
| 角色表副本 `tests/fixtures/action-roles.json` sha256 | `2784f446c70d` |
| 頁面母體 | repo 根目錄的 `*.html` **現掃**（不是手寫清單） |
| 頁數 | 14 |

⚠️ 刻意不寫產生時間——帶時間戳的基準檔每次重跑都會 diff，
而「全部都在動」與「有一格變了」在 diff 上會長得一樣。

## 逐頁

`入口`＝後端 `dispatchPages` 宣告的那一支（只有分流頁有）。
`角色門檻`＝這一頁 inline 打得到的 action 各自註冊的角色集合，**去重後排序**。

| 頁                   | ① `?t=`                 | ② 入口（第一道）                            | ② 角色門檻 |
|----------------------|--------------------------|----------------------------------------------|---|
| `admin.html`         | 墓碑（只在註解）         | `未宣告`                                     | `（抽不到）` |
| `attend.html`        | 活的                     | `getActivityStats [admin,activity,view]`     | `admin,activity,view`<br>`admin,any,view` |
| `authz.html`         | 墓碑（只在註解）         | `getAuthzList [admin]`                       | `（抽不到）` |
| `board.html`         | 墓碑（讀了但不送）       | `getCheckinPending [admin,hr]`               | `admin,any`<br>`admin,any,view`<br>`admin,hr`<br>`admin,hr,activity,hrstats`<br>`admin,public` |
| `checkin.html`       | 活的                     | `未宣告`                                     | `admin,activity,screen` |
| `hr-stats.html`      | 墓碑（讀了但不送）       | `getHrStats [admin,hrstats]`                 | `admin,hrstats` |
| `index.html`         | 沒有這條路               | `未宣告`                                     | `admin,public` |
| `line-messages.html` | 墓碑（讀了但不送）       | `getMessageLog [admin,activity]`             | `（抽不到）` |
| `line.html`          | 墓碑（只在註解）         | `getWelfareAudience [admin,messaging]`       | `admin,messaging` |
| `me.html`            | 墓碑（只在註解）         | `未宣告`                                     | `（抽不到）` |
| `staff.html`         | 活的                     | `未宣告`                                     | `admin,staff` |
| `stats.html`         | 活的                     | `getActivityStats [admin,activity,view]`     | `admin,activity`<br>`admin,activity,view`<br>`admin,any`<br>`admin,any,view`<br>`admin,hr,activity,hrstats` |
| `verify.html`        | 活的                     | `未宣告`                                     | `admin,public` |
| `wall.html`          | 活的                     | `未宣告`                                     | `admin,activity,view,screen` |
