// 腕時計せどりナビ 拡張：商品ページ・検索一覧に常駐するスクリプト（data.js, core.js の後に読み込まれる）
(() => {
  if (window.__wsxLoaded) return; window.__wsxLoaded = true;
  const T = window.__wsxTest || null;  // 動作確認用（通常は未定義）
  const H = T?.host || location.hostname, P = T?.path || location.pathname;
  const site = H.includes('mercari.com') ? 'mercari' : H.includes('paypayfleamarket') ? 'yfm' : H.includes('auctions.yahoo.co.jp') ? 'yahoo' : null;
  if (!site) return;
  const isItem = site === 'yahoo' ? /\/jp\/auction\//.test(P) : /\/item\/|\/shops\/product\//.test(P);
  const isSearch = site === 'yahoo' ? /^\/(search|closedsearch|opensearch)/.test(P) : /^\/search/.test(P);
  if (!isItem && !isSearch) return;

  const SITEN = { yahoo: 'ヤフオク', mercari: 'メルカリ', yfm: 'Yahoo!フリマ' };
  const SHIPKEY = { yahoo: 'bYah', mercari: 'bMer', yfm: 'bYfm' };
  const TOOL_URL = 'https://004zero.github.io/watch-sedori/';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = n => (n < 0 ? '−' : '') + '¥' + Math.abs(Math.round(n)).toLocaleString();
  const pct = n => Math.round(n) + '%';
  const num = t => { const m = String(t || '').replace(/,/g, '').match(/\d{2,9}/); return m ? +m[0] : null; };
  const txtOf = sels => { for (const s of sels) { const el = document.querySelector(s); if (el && el.innerText && el.innerText.trim()) return el.innerText.trim(); } return ''; };
  const og = p => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute('content') || '';
  const send = msg => new Promise(res => chrome.runtime.sendMessage(msg, r => res(r || { ok: false, error: chrome.runtime.lastError?.message || '応答なし' })));
  const mid = a => (a[0] + a[1]) / 2;

  let SET = null;
  async function loadSet() { const r = await send({ type: 'GET_SET' }); SET = r.set || {}; return SET; }
  const fixCheap = mv => (SET['c_' + mv] ?? FIXCOST[mv][0]);
  const fixBig = mv => (SET['b_' + mv] ?? FIXCOST[mv][2]);

  // ── 相場（実測があれば実測、なければDBの目安） → 販売先別手取り ──
  function grosses(it, market) {
    const y = market?.yahoo?.median ?? mid(it.y), m = market?.mercari?.median ?? mid(it.m);
    const f = market?.yfm?.median ?? m * (1 - (SET.yfmDisc ?? 5) / 100);
    return { yahoo: y, mercari: m, yfm: f, real: { yahoo: !!market?.yahoo, mercari: !!market?.mercari, yfm: !!market?.yfm } };
  }
  function nets(g, mul) {
    return [
      { id: 'mercari', n: 'メルカリ', gross: g.mercari * mul, net: calcNet(g.mercari * mul, SET.fMer, SET.sMer, SET.pack), real: g.real.mercari },
      { id: 'yahoo', n: 'ヤフオク', gross: g.yahoo * mul, net: calcNet(g.yahoo * mul, SET.fYah, SET.sYah, SET.pack), real: g.real.yahoo },
      { id: 'yfm', n: 'Yahoo!フリマ', gross: g.yfm * mul, net: calcNet(g.yfm * mul, SET.fYfm, SET.sYfm, SET.pack), real: g.real.yfm },
    ];
  }
  // 1件分の総合判定
  function evaluate({ text, it, mv, price, ship, market, ai }) {
    const jd = judge(text, mv);
    const score = Math.max(0, Math.min(100, jd.score + (ai?.revive_adjust || 0)));
    const mul = jd.saleMul * (ai?.sale_multiplier || 1);
    if (!it) return { jd, score, mul, hasModel: false, verdict: { v: 'モデル不明', cls: 'wn', why: 'モデルを選ぶと金額を計算します。' } };
    const g = grosses(it, market); const ds = nets(g, mul); const best = ds.reduce((a, b) => b.net > a.net ? b : a);
    const junkNet = mid(it.j) * (1 - SET.fMer / 100) - SET.sMer - SET.pack;
    const cheap = fixCheap(mv) + jd.extra + (ai?.extra_cost_yen || 0), big = fixBig(mv);
    const J = evalJunk({ p: score / 100, buy: price + ship, cheap, big, bestNet: best.net, junkNet, tgtPct: SET.tgtPct, tgtMin: SET.tgtMin });
    let verdict = verdictOf({ score, price, ship, J, hasModel: true });
    if (ai?.fake_risk === 'high') verdict = { v: '見送り', cls: 'ng', why: 'AIが偽物リスク「高」と判定しました。' };
    const diff = best.net - price - ship;  // 動作品として買った場合の差額
    return { jd, score, mul, hasModel: true, ds, best, J, cheap, big, verdict, diff, g };
  }

  // ════════════ 商品ページ ════════════
  function extractItem() {
    let title = (document.querySelector('h1')?.innerText || og('og:title') || document.title || '').trim();
    let desc = '', price = null, images = [];
    const bt = document.body.innerText || '';
    const imgs = sel => { const out = []; const seen = new Set(); for (const im of document.querySelectorAll(sel)) { const s = im.currentSrc || im.src; if (!s || seen.has(s) || /\.svg|icon|logo|avatar|profile/i.test(s)) continue; if ((im.naturalWidth || im.width || 0) < 120) continue; seen.add(s); out.push(s); if (out.length >= 5) break; } return out; };
    if (site === 'yahoo') {
      desc = txtOf(['#ProductExplanation', '.ProductExplanation__commentBody', '[class*="ProductExplanation"]']) || og('og:description');
      price = num(txtOf(['.Price__value', '[class*="Price__value"]']));
      const m = bt.match(/現在\s*([\d,]+)\s*円/) || bt.match(/即決\s*([\d,]+)\s*円/) || bt.match(/落札\s*([\d,]+)\s*円/);
      if (!price && m) price = +m[1].replace(/,/g, '');
      images = imgs('img[src*="auctions.c.yimg.jp"], img[src*="auc-pctr.c.yimg.jp"]');
    } else if (site === 'mercari') {
      desc = txtOf(['[data-testid="description"]', 'pre[class*="description"]', '[class*="description"]']) || og('og:description');
      price = num(txtOf(['[data-testid="price"]'])) || num(og('product:price:amount'));
      images = imgs('img[src*="mercdn.net"]');
    } else {
      desc = txtOf(['[class*="description"]', '[class*="Description"]']) || og('og:description');
      price = num(og('product:price:amount')) || (bt.match(/([\d,]{3,})\s*円/) ? +bt.match(/([\d,]{3,})\s*円/)[1].replace(/,/g, '') : null);
      images = imgs('img[src*="yimg.jp"]');
    }
    title = title.replace(/\s*[-|｜].*(ヤフオク|メルカリ|Yahoo!フリマ).*$/, '').trim();
    return { title, desc: (desc || '').slice(0, 4000), price: price || 0, images, url: location.href.split('?')[0] };
  }

  let state = null;  // {item, it, mv, price, market, ai}
  function panel() {
    let p = document.getElementById('wsx-panel');
    if (!p) { p = document.createElement('div'); p.id = 'wsx-panel'; document.body.appendChild(p); }
    return p;
  }
  function closePanel() { const p = document.getElementById('wsx-panel'); if (p) p.remove(); }
  const modelOptions = sel => '<option value="">（モデル未特定）</option>' + ITEMS.map(it => `<option value="${it.id}"${it.id === sel ? ' selected' : ''}>${esc(it.brand + ' ' + it.name)}</option>`).join('');
  const mvOptions = sel => Object.entries(MV).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${v[0]}</option>`).join('');

  function renderPanel(msg) {
    const p = panel();
    if (msg) { p.innerHTML = `<button class="wsx-x" id="wsx-x">✕</button><h3>⌚ 腕時計せどりナビ</h3><div>${esc(msg)}</div>`; p.querySelector('#wsx-x').onclick = closePanel; return; }
    const s = state; const text = s.item.title + '\n' + s.item.desc;
    const R = evaluate({ text, it: s.it, mv: s.mv, price: s.price, ship: s.ship, market: s.market, ai: s.ai });
    const lvl = R.score >= 65 ? ['高い', 'ok'] : R.score >= 40 ? ['五分五分', 'wn'] : ['低い', 'ng'];
    const reasons = R.jd.reasons.filter(r => r.d !== 0).slice(0, 6);
    const mk = s.market;
    p.innerHTML = `<button class="wsx-x" id="wsx-x">✕</button><h3>⌚ 腕時計せどりナビ</h3>
      <div class="wsx-verdict ${R.verdict.cls}">${esc(R.verdict.v)}</div>
      <div class="muted">${esc(R.verdict.why || '')}</div>
      <div class="wsx-row"><label class="muted">モデル</label><select id="wsx-model" style="flex:1;min-width:200px">${modelOptions(s.it?.id)}</select></div>
      <div class="wsx-row"><label class="muted">ムーブ</label><select id="wsx-mv">${mvOptions(s.mv)}</select>
        <label class="muted">価格</label><input id="wsx-price" type="number" value="${s.price}" style="width:100px">円
        <label class="muted">＋送料</label><input id="wsx-ship" type="number" value="${s.ship}" style="width:70px">円</div>
      <div class="wsx-grid">
        <div class="wsx-stat"><div class="l">電池交換などで動く見込み</div><div class="v ${lvl[1]}">${R.score}% <span class="muted">${lvl[0]}</span></div></div>
        ${R.hasModel ? `<div class="wsx-stat"><div class="l">買っていい上限（送料込）</div><div class="v">${yen(R.J.maxBuy)}</div></div>
        <div class="wsx-stat"><div class="l">動いたら売る先</div><div class="v" style="font-size:14px">${esc(R.best.n)}${R.best.real ? ' <span class="muted">実測</span>' : ''}<div class="muted">手取り ${yen(R.best.net)}</div></div></div>
        <div class="wsx-stat"><div class="l">期待利益</div><div class="v ${R.J.ev > 0 ? 'ok' : 'ng'}">${yen(R.J.ev)}</div></div>
        <div class="wsx-stat"><div class="l">直す費用</div><div class="v" style="font-size:14px">${yen(R.cheap)}<div class="muted">${esc(FIXCOST[s.mv][1])}</div></div></div>
        <div class="wsx-stat"><div class="l">動作品として買う差額</div><div class="v ${R.diff > 0 ? 'ok' : 'ng'}" style="font-size:14px">${yen(R.diff)}</div></div>` : ''}
      </div>
      ${R.hasModel ? `<div class="muted">相場（売れた価格の中央値）：ヤフオク ${mk?.yahoo ? yen(mk.yahoo.median) + '（' + mk.yahoo.n + '件）' : yen(R.g.yahoo) + '（目安）'} ／ メルカリ ${mk?.mercari ? yen(mk.mercari.median) + '（' + mk.mercari.n + '件）' : yen(R.g.mercari) + '（目安）'} ／ Yahoo!フリマ ${mk?.yfm ? yen(mk.yfm.median) + '（' + mk.yfm.n + '件）' : yen(R.g.yfm) + '（目安）'}${mk?.cached ? ' <span class="muted">[キャッシュ]</span>' : ''}</div>` : ''}
      ${reasons.length ? `<div style="margin-top:6px"><b>判定の根拠</b>${reasons.map(r => `<div class="wsx-reason"><span class="d ${r.d > 0 ? 'ok' : 'ng'}">${r.d > 0 ? '+' : ''}${r.d}</span><span>${esc(r.label)}</span></div>`).join('')}</div>` : ''}
      ${s.ai ? `<div class="wsx-ai"><b>🤖 AI写真判定</b>（${esc(s.ai.model || '')}・写真${s.ai.imagesUsed}枚）<div>${esc(s.ai.summary)}</div>
        <div class="muted">復活確率 ${s.ai.revive_adjust >= 0 ? '+' : ''}${s.ai.revive_adjust}点 ／ 状態 ${esc(s.ai.condition_grade)} ／ 売値 ×${s.ai.sale_multiplier.toFixed(2)} ／ 偽物リスク ${esc(s.ai.fake_risk)}${s.ai.extra_cost_yen ? ' ／ 追加費用 ' + yen(s.ai.extra_cost_yen) : ''}</div>
        <ul>${(s.ai.findings || []).map(f => `<li>${esc(f)}</li>`).join('')}</ul><div><b>${esc(s.ai.advice)}</b></div></div>` : ''}
      <div class="wsx-row">
        <button class="wsx-b" id="wsx-ai" ${s.ai ? 'disabled' : ''}>🤖 AIで写真と説明を判定</button>
        <button class="wsx-b green" id="wsx-save">候補に保存</button>
        <button class="wsx-b ghost" id="wsx-refresh" title="相場を取り直す">相場更新</button>
      </div>
      <div class="wsx-row muted">${s.it ? `<a href="https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=${encodeURIComponent(s.it.kj)}&va=${encodeURIComponent(s.it.kj)}&exflg=1&b=1&n=50&s1=end&o1=d" target="_blank" rel="noopener">ヤフオク落札</a> ・ <a href="https://jp.mercari.com/search?keyword=${encodeURIComponent(s.it.kj)}&status=sold_out" target="_blank" rel="noopener">メルカリ売切</a> ・ ` : ''}<a href="${TOOL_URL}" target="_blank" rel="noopener">Webツール</a></div>
      <div id="wsx-note" class="muted"></div>`;
    p.querySelector('#wsx-x').onclick = closePanel;
    p.querySelector('#wsx-model').onchange = async e => { s.it = ITEMS.find(x => x.id === e.target.value) || null; s.mv = s.it ? s.it.mv : s.mv; s.market = null; s.ai = null; await fetchMarketFor(); renderPanel(); };
    p.querySelector('#wsx-mv').onchange = e => { s.mv = e.target.value; renderPanel(); };
    p.querySelector('#wsx-price').onchange = e => { s.price = +e.target.value || 0; renderPanel(); };
    p.querySelector('#wsx-ship').onchange = e => { s.ship = +e.target.value || 0; renderPanel(); };
    p.querySelector('#wsx-refresh').onclick = async () => { await fetchMarketFor(true); renderPanel(); };
    p.querySelector('#wsx-ai').onclick = runAI;
    p.querySelector('#wsx-save').onclick = async () => {
      const c = { id: 'c' + Date.now(), at: new Date().toISOString(), site: SITEN[site], title: s.item.title.slice(0, 100), url: s.item.url, price: s.price, ship: s.ship,
        model: s.it ? s.it.brand + ' ' + s.it.name : '', mv: MV[s.mv][0], score: R.score, verdict: R.verdict.v, maxBuy: R.hasModel ? Math.round(R.J.maxBuy) : null, ev: R.hasModel ? Math.round(R.J.ev) : null, bestDst: R.hasModel ? R.best.n : '', bestNet: R.hasModel ? Math.round(R.best.net) : null, ai: s.ai ? s.ai.summary : '' };
      const r = await send({ type: 'SAVE_CAND', cand: c }); note(r.ok ? `候補に保存しました（${r.n}件）。拡張アイコンから一覧・CSV出力できます。` : '保存失敗: ' + r.error);
    };
  }
  function note(t) { const n = document.getElementById('wsx-note'); if (n) n.textContent = t; }
  async function fetchMarketFor(force) {
    if (!state.it) { state.market = null; return; }
    note('相場を取得中（ヤフオク落札・メルカリ売切・Yahoo!フリマ）… 裏でタブが開いて自動で閉じます');
    const r = await send({ type: 'FETCH_MARKET', model: { id: state.it.id, kj: state.it.kj }, force: !!force });
    state.market = r.ok ? r.data : null; if (!r.ok) note('相場取得に失敗: ' + r.error);
  }
  async function runAI() {
    const b = document.getElementById('wsx-ai'); if (b) { b.disabled = true; b.textContent = '🤖 AIが写真を見ています…'; }
    const s = state; const R = evaluate({ text: s.item.title + '\n' + s.item.desc, it: s.it, mv: s.mv, price: s.price, ship: s.ship, market: s.market });
    const r = await send({ type: 'AI_JUDGE', payload: { title: s.item.title, desc: s.item.desc, price: s.price, site: SITEN[site], images: s.item.images, modelName: s.it ? s.it.brand + ' ' + s.it.name : '', mvName: MV[s.mv][0], ruleScore: R.score } });
    if (r.ok) { s.ai = r.ai; renderPanel(); } else { renderPanel(); note('AI判定に失敗: ' + r.error); }
  }
  async function runItem(btn) {
    btn.disabled = true; btn.textContent = '⌚ 判定中…';
    try {
      await loadSet();
      const item = extractItem(); const text = item.title + '\n' + item.desc;
      const c = detectModel(text); const it = c.length ? c[0].it : null;
      state = { item, it, mv: it ? it.mv : 'QZ', price: item.price, ship: SET[SHIPKEY[site]] ?? 0, market: null, ai: null };
      renderPanel('相場を取得中…（ヤフオク落札・メルカリ売切・Yahoo!フリマを裏タブで確認します。10〜20秒）');
      await fetchMarketFor();
      renderPanel();
    } catch (e) { renderPanel('エラー: ' + (e.message || e)); }
    finally { btn.disabled = false; btn.textContent = '⌚ 判定'; }
  }

  // ════════════ 検索一覧 ════════════
  function getCards() {
    const out = [];
    if (site === 'yahoo') {
      // 新UI：商品リンク → 「円」を含む最小の祖先をカードとみなす（クラス名はハッシュ化されるので使わない）
      const seen = new Set();
      for (const a of document.querySelectorAll('a[href*="/jp/auction/"]')) {
        const h = a.href.split('?')[0]; if (seen.has(h)) continue;
        let el = a, card = null;
        for (let i = 0; i < 8 && el; i++) { const t = el.innerText || ''; if (/[\d,]{3,}円/.test(t) && t.length < 700) { card = el; break; } el = el.parentElement; }
        if (!card) continue; seen.add(h);
        const txt = card.innerText || '';
        const pm = txt.replace(/,/g, '').match(/(?:現在|即決|落札)\s*\n?\s*(\d{2,9})円/) || txt.replace(/,/g, '').match(/(\d{3,9})円/);
        const img = card.querySelector('img[alt]');
        const t = (img && img.alt) || (txt.split('\n').map(s => s.trim()).find(s => s.length >= 8 && !/円|送料無料|鑑定付き/.test(s)) || '');
        if (t && pm) out.push({ el: card, title: t, price: +pm[1] });
      }
      if (!out.length) for (const li of document.querySelectorAll('.Product, li.Product')) {  // 旧UI
        const t = txtIn(li, ['.Product__titleLink', '.Product__title', 'h3']); const pr = num(txtIn(li, ['.Product__priceValue', '.Product__price']));
        if (t && pr) out.push({ el: li.querySelector('.Product__title') || li, title: t, price: pr });
      }
    } else if (site === 'mercari') {
      let cells = document.querySelectorAll('li[data-testid="item-cell"], [data-testid="item-cell"]');
      if (!cells.length) cells = document.querySelectorAll('a[href*="/item/m"], a[href*="/shops/product/"]');
      for (const li of cells) {
        const txt = (li.innerText || '') + ' ' + Array.from(li.querySelectorAll('[aria-label]')).map(e => e.getAttribute('aria-label')).join(' ');
        const m = txt.replace(/,/g, '').match(/[¥￥]\s?(\d+)|(\d{3,})円/); if (!m) continue;
        const img = li.querySelector('img[alt]'); const t = ((img && img.alt) || (txt.split('\n').find(s => s.trim() && !/[¥￥]/.test(s)) || '')).replace(/の(画像|サムネイル).*$/, '').trim();
        if (t) out.push({ el: li, title: t, price: +(m[1] || m[2]) });
      }
    } else {
      const seen = new Set();
      for (const a of document.querySelectorAll('a[href*="/item/"]')) {
        const txt = a.innerText || ''; const m = txt.replace(/,/g, '').match(/(\d+)\s*円|[¥￥]\s?(\d+)/); if (!m || seen.has(a.href)) continue; seen.add(a.href);
        const img = a.querySelector('img[alt]:not([alt="sold"])'); const t = (img && img.alt) || ''; if (t) out.push({ el: a, title: t, price: +(m[1] || m[2]) });
      }
    }
    return out;
  }
  function txtIn(root, sels) { for (const s of sels) { const el = root.querySelector(s); if (el && el.innerText && el.innerText.trim()) return el.innerText.trim(); } return ''; }
  async function runSearch(btn) {
    btn.disabled = true;
    try {
      await loadSet();
      const cards = getCards().slice(0, 60);
      if (!cards.length) { alert('商品が見つかりませんでした（ページ構造が変わった可能性）'); return; }
      const ship = SET[SHIPKEY[site]] ?? 0;
      cards.forEach(c => { const d = detectModel(c.title); c.it = d.length ? d[0].it : null; });
      const models = [...new Map(cards.filter(c => c.it).map(c => [c.it.id, c.it])).values()].slice(0, 10);
      const markets = {};
      for (let i = 0; i < models.length; i++) {
        btn.textContent = `⌚ 相場取得中 ${i + 1}/${models.length}（${models[i].brand}）`;
        const r = await send({ type: 'FETCH_MARKET', model: { id: models[i].id, kj: models[i].kj } }); if (r.ok) markets[models[i].id] = r.data;
      }
      for (const c of cards) {
        c.el.querySelectorAll('.wsx-badge').forEach(b => b.remove());
        const badge = document.createElement('span'); badge.className = 'wsx-badge';
        if (!c.it) { badge.classList.add('na'); badge.textContent = '⌚ モデル不明'; }
        else if (!markets[c.it.id]) { badge.classList.add('na'); badge.textContent = '⌚ 相場未取得'; }
        else {
          const R = evaluate({ text: c.title, it: c.it, mv: c.it.mv, price: c.price, ship, market: markets[c.it.id] });
          badge.classList.add(R.verdict.cls);
          badge.textContent = `⌚ ${R.verdict.v}　復活${R.score}%　上限${yen(R.J.maxBuy)}　期待${yen(R.J.ev)}`;
          badge.title = `${c.it.brand} ${c.it.name}\n売る先 ${R.best.n} 手取り ${yen(R.best.net)}`;
        }
        (c.el.querySelector('h3, .Product__title') || c.el).appendChild(badge);
      }
      btn.textContent = `⌚ 判定済み（${cards.length}件・再判定）`;
    } catch (e) { alert('判定エラー: ' + (e.message || e)); btn.textContent = '⌚ 一覧を判定'; }
    finally { btn.disabled = false; }
  }

  // ── ボタン設置 ──
  function mount() {
    if (document.getElementById('wsx-btn') || !document.body) return;
    const btn = document.createElement('button'); btn.id = 'wsx-btn'; btn.type = 'button';
    btn.textContent = isItem ? '⌚ 判定' : '⌚ 一覧を判定';
    btn.onclick = () => isItem ? runItem(btn) : runSearch(btn);
    document.body.appendChild(btn);
  }
  mount(); setTimeout(mount, 1500); setTimeout(mount, 4000);
})();
