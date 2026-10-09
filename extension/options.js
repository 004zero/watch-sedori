const DEF = { rate: 150, fMer: 10, fYah: 10, fYfm: 5, sMer: 210, sYah: 230, sYfm: 200, pack: 150, tgtPct: 20, tgtMin: 1500, bYah: 600, bMer: 0, bYfm: 0, yfmDisc: 5, apiKey: '', model: 'claude-opus-5-5', effort: 'medium', cacheHours: 24 };
Object.keys(FIXCOST).forEach(k => { DEF['c_' + k] = FIXCOST[k][0]; DEF['b_' + k] = FIXCOST[k][2]; });
const $ = s => document.querySelector(s);
$('#fix').innerHTML = Object.keys(FIXCOST).map(k => `<div class="field"><label>${MV[k][0]}：${FIXCOST[k][1]}</label><input type="number" id="c_${k}"></div><div class="field"><label>${MV[k][0]}：${FIXCOST[k][3]}</label><input type="number" id="b_${k}"></div>`).join('');
async function load() {
  const o = await chrome.storage.local.get('wsx_set'); const set = Object.assign({}, DEF, o.wsx_set || {});
  Object.keys(DEF).forEach(k => { const el = document.getElementById(k); if (el) el.value = set[k]; });
}
$('#save').onclick = async () => {
  const set = {}; Object.keys(DEF).forEach(k => { const el = document.getElementById(k); if (!el) return; set[k] = el.type === 'number' ? +el.value : el.value.trim(); });
  await chrome.storage.local.set({ wsx_set: set }); $('#msg').textContent = '保存しました'; setTimeout(() => $('#msg').textContent = '', 2000);
};
$('#reset').onclick = async () => { await chrome.storage.local.set({ wsx_set: {} }); await load(); $('#msg').textContent = '初期値に戻しました'; };
$('#test').onclick = async () => {
  const key = $('#apiKey').value.trim(); const out = $('#testOut');
  if (!key) { out.innerHTML = ' <span class="ng">APIキーを入力してください</span>'; return; }
  out.textContent = ' 接続中…';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: $('#model').value, max_tokens: 64, messages: [{ role: 'user', content: 'ping と1語だけ返してください' }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || r.status);
    out.innerHTML = ` <span class="ok">接続OK（${j.model}）</span>`;
  } catch (e) { out.innerHTML = ` <span class="ng">失敗: ${String(e.message || e).slice(0, 200)}</span>`; }
};
load();
