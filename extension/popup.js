const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yen = n => n == null ? '—' : (n < 0 ? '−' : '') + '¥' + Math.abs(Math.round(n)).toLocaleString();
const cls = v => v === '買い' ? 'ok' : v === '見送り' ? 'ng' : 'wn';
let CAND = [];
async function load() {
  const o = await chrome.storage.local.get('wsx_cand'); CAND = o.wsx_cand || [];
  if (!CAND.length) { $('#list').innerHTML = '<div class="muted">候補はまだありません。商品ページで「⌚ 判定」→「候補に保存」。</div>'; return; }
  $('#list').innerHTML = `<table><tr><th>日付</th><th>商品</th><th>価格</th><th>判定</th><th>上限</th><th>期待利益</th><th></th></tr>${CAND.map(c => `<tr>
    <td class="muted">${c.at.slice(5, 10)}</td><td><a href="${esc(c.url)}" target="_blank">${esc(c.title.slice(0, 40))}</a><div class="muted">${esc(c.model || '')} ${esc(c.site)}</div></td>
    <td>${yen(c.price)}</td><td class="${cls(c.verdict)}">${esc(c.verdict)}<div class="muted">${c.score}%</div></td><td>${yen(c.maxBuy)}</td><td class="${c.ev > 0 ? 'ok' : 'ng'}">${yen(c.ev)}</td>
    <td><button class="ghost" data-del="${c.id}">×</button></td></tr>`).join('')}</table>`;
  $('#list').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { CAND = CAND.filter(c => c.id !== b.dataset.del); await chrome.storage.local.set({ wsx_cand: CAND }); chrome.runtime.sendMessage({ type: 'REFRESH_BADGE' }); load(); });
}
$('#opt').onclick = () => chrome.runtime.openOptionsPage();
$('#tool').onclick = () => chrome.tabs.create({ url: 'https://004zero.github.io/watch-sedori/' });
$('#cache').onclick = () => chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' }, () => alert('相場キャッシュを削除しました'));
$('#clear').onclick = async () => { if (confirm('候補をすべて削除しますか？')) { await chrome.storage.local.set({ wsx_cand: [] }); chrome.runtime.sendMessage({ type: 'REFRESH_BADGE' }); load(); } };
$('#csv').onclick = () => {
  const q = v => { const s = String(v ?? '').replace(/\r?\n/g, ' '); return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['日付', 'サイト', 'タイトル', 'URL', '価格', '送料', 'モデル', 'ムーブ', '復活確率', '判定', '仕入上限', '最良販売先', '手取り', '期待利益', 'AI要約']]
    .concat(CAND.map(c => [c.at.slice(0, 10), c.site, c.title, c.url, c.price, c.ship, c.model, c.mv, c.score + '%', c.verdict, c.maxBuy ?? '', c.bestDst, c.bestNet ?? '', c.ev ?? '', c.ai]));
  const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'watch-sedori-ext-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
};
load();
