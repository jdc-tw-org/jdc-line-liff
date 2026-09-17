/**
 * e2e 的 port 只有這一個來源。
 *
 * 🔴 **為什麼值得獨立一個檔**：`playwright.config.js` 與 `serve.js` 如果各自寫一次
 *    `process.env.E2E_PORT || 4173`，預設值就有兩份，改了一邊不會有任何錯誤訊息。
 *    而「兩邊對不上」正是這個檔要消滅的那個 bug——config 曾經把 port 寫死成 4173、
 *    `serve.js` 卻已經在讀環境變數，於是**設了 `E2E_PORT` 也沒用**：
 *    伺服器起在新 port、瀏覽器還是去敲 4173。
 */
const PORT = Number(process.env.E2E_PORT || 4173);
const ORIGIN = 'http://127.0.0.1:' + PORT;

module.exports = { PORT, ORIGIN };
