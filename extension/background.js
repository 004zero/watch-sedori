// 腕時計せどりナビ 拡張：Service Worker（MV3）
//  役割：①相場の取得（裏タブでヤフオク落札・メルカリ売切・Yahoo!フリマ売切を開いて価格を抽出、24時間キャッシュ）
//        ②Claude API で写真＋説明文のAI判定
//        ③設定・仕入れ候補の保存

const DEF = {
  rate: 150, fMer: 10, fYah: 10, fYfm: 5, sMer: 210, sYah: 230, sYfm: 200, pack: 150,
  tgtPct: 20, tgtMin: 1500, bYah: 600, bMer: 0, bYfm: 0, yfmDisc: 5,
  apiKey: '', model: 'claude-opus-5-5', effort: 'medium', cacheHours: 24,
};
const CACHE_KEY = 'wsx_cache', SET_KEY = 'wsx_set', CAND_KEY = 'wsx_cand';

async function getSet() { const o = await chrome.storage.local.get(SET_KEY); return Object.assign({}, DEF, o[SET_KEY] || {}); }

// ── 裏タブで検索結果を開いて価格を抽出 ──────────────────────────
function waitComplete(tabId, timeout = 15000) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; chrome.tabs.onUpdated.removeListener(l); resolve(); };
    const l = (id, info) => { if (id === tabId && info.status === 'complete') finish(); };
    chrome.tabs.onUpdated.addListener(l); setTimeout(finish, timeout);
  });
}
async function openAndScrape(url, func) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await waitComplete(tab.id);
    const [inj] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func });
    return Array.isArray(inj?.result) ? inj.result : [];
  } catch (e) { console.warn('[wsx] scrape失敗', url, e); return []; }
  finally { if (tab?.id) { try { await chrome.tabs.remove(tab.id); } catch (_) {} } }
}

// 以下3つはページ内に注入される（外部スコープ参照不可・自己完結）
async function scrapeYahooClosed() {
  // 2026年の新UI（クラス名がハッシュ化）に対応：商品リンク → 「円」を含む最小の祖先をカードとみなす
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let as = [];
  for (let i = 0; i < 12; i++) { as = Array.from(document.querySelectorAll('a[href*="/jp/auction/"]')); if (as.length) break; await sleep(500); }
  const items = []; const seen = new Set();
  for (const a of as) {
    const h = a.href.split('?')[0]; if (seen.has(h)) continue;
    let el = a, card = null;
    for (let i = 0; i < 8 && el; i++) { const t = el.innerText || ''; if (/[\d,]{3,}円/.test(t) && t.length < 700) { card = el; break; } el = el.parentElement; }
    if (!card) continue; seen.add(h);
    const txt = card.innerText || '';
    const pm = txt.replace(/,/g, '').match(/落札\s*\n?\s*(\d{2,9})円/) || txt.replace(/,/g, '').match(/(\d{3,9})円/);
    if (!pm) continue;
    const img = card.querySelector('img[alt]');
    const t = (img && img.alt) || (txt.split('\n').map(s => s.trim()).find(s => s.length >= 8 && !/円|送料無料|鑑定付き/.test(s)) || '');
    const bm = txt.match(/円\n+(\d+)\n/); // 入札数（落札価格のあとの数字）
    items.push({ t: t.slice(0, 120), p: +pm[1], b: bm ? +bm[1] : null });
    if (items.length >= 60) break;
  }
  // 旧UIのフォールバック
  if (!items.length) for (const li of document.querySelectorAll('.Product, li.Product')) {
    const t = li.querySelector('.Product__titleLink, .Product__title')?.innerText?.trim() || '';
    const m = (li.querySelector('.Product__priceValue, .Product__price')?.innerText || '').replace(/,/g, '').match(/\d+/);
    if (m && t) items.push({ t, p: +m[0] });
  }
  return items;
}
async function scrapeMercariSold() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let cells = [];
  for (let i = 0; i < 16; i++) { cells = Array.from(document.querySelectorAll('li[data-testid="item-cell"], [data-testid="item-cell"]')); if (cells.length) break; await sleep(500); }
  // item-cell が無い場合は商品リンクから拾う（DOM変更への保険）
  if (!cells.length) cells = Array.from(document.querySelectorAll('a[href*="/item/m"], a[href*="/shops/product/"]'));
  const items = []; const seen = new Set();
  for (const li of cells) {
    const key = li.querySelector('a[href]')?.href || li.href || li.innerText; if (seen.has(key)) continue; seen.add(key);
    const txt = (li.innerText || '') + ' ' + Array.from(li.querySelectorAll('[aria-label]')).map(e => e.getAttribute('aria-label')).join(' ') + ' ' + (li.getAttribute('aria-label') || '');
    const m = txt.replace(/,/g, '').match(/[¥￥]\s?(\d+)|(\d{3,})円/);
    if (!m) continue;
    const img = li.querySelector('img[alt]');
    const t = (img && img.alt) || (txt.split('\n').find(s => s.trim() && !/[¥￥]/.test(s)) || '').trim();
    items.push({ t: t.replace(/の(画像|サムネイル).*$/, '').slice(0, 120), p: +(m[1] || m[2]) });
  }
  return items;
}
async function scrapeYfm() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let as = [];
  for (let i = 0; i < 16; i++) { as = Array.from(document.querySelectorAll('a[href*="/item/"]')); if (as.length) break; await sleep(500); }
  const items = []; const seen = new Set();
  for (const a of as) {
    const txt = a.innerText || ''; const m = txt.replace(/,/g, '').match(/(\d+)\s*円|[¥￥]\s?(\d+)/);
    if (!m || seen.has(a.href)) continue; seen.add(a.href);
    const img = a.querySelector('img[alt]:not([alt="sold"])');
    items.push({ t: (img && img.alt) || '', p: +(m[1] || m[2]) });
  }
  return items;
}

function stats(arr) {
  const a = arr.filter(n => isFinite(n) && n > 0).sort((x, y) => x - y); if (!a.length) return null;
  const q = p => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  return { n: a.length, median: q(.5), p25: q(.25), p75: q(.75), min: a[0], max: a[a.length - 1] };
}
const enc = encodeURIComponent;

async function fetchMarket(model, force) {
  const set = await getSet();
  const o = await chrome.storage.local.get(CACHE_KEY); const cache = o[CACHE_KEY] || {};
  const hit = cache[model.id];
  if (!force && hit && Date.now() - hit.at < set.cacheHours * 3600 * 1000) return { ...hit, cached: true };
  const kj = model.kj;
  const y = await openAndScrape(`https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=${enc(kj)}&va=${enc(kj)}&exflg=1&b=1&n=50&s1=end&o1=d`, scrapeYahooClosed);
  const m = await openAndScrape(`https://jp.mercari.com/search?keyword=${enc(kj)}&status=sold_out`, scrapeMercariSold);
  const f = await openAndScrape(`https://paypayfleamarket.yahoo.co.jp/search/${enc(kj)}?sold=1`, scrapeYfm);
  const res = { at: Date.now(), kj, yahoo: stats(y.map(i => i.p)), mercari: stats(m.map(i => i.p)), yfm: stats(f.map(i => i.p)),
    samples: { yahoo: y.slice(0, 8), mercari: m.slice(0, 8), yfm: f.slice(0, 8) } };
  cache[model.id] = res;
  // キャッシュは最大60モデル
  const keys = Object.keys(cache); if (keys.length > 60) keys.sort((a, b) => cache[a].at - cache[b].at).slice(0, keys.length - 60).forEach(k => delete cache[k]);
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
  return { ...res, cached: false };
}

// ── Claude API：写真＋説明文のAI判定 ──────────────────────────
const AI_SYSTEM = `あなたは中古腕時計の査定とせどり（転売）の専門家です。出品の写真と説明文、推定モデル、ルールベースの復活確率を受け取り、
(1) 電池交換・充電などの安い処置で動く可能性、(2) 写真から分かる状態（液晶の薄さ・欠け、液漏れ痕、ベゼル/バンドの加水分解・割れ、ガラス傷、針・文字盤の劣化、錆、リューズ）、
(3) 偽物の兆候（ロゴや印字の品質、裏蓋刻印、ダイヤルの粗さ、人気コラボ・高級ブランドの不自然な安さ）、(4) 付属品と状態から見た売値の補正、を判定します。
断定できない点は「写真では判断不能」と書き、推測で減点しすぎないでください。数値の目安：revive_adjust は -60〜+30 の整数（ルール点数への加減点）、sale_multiplier は 0.5〜1.3（状態・付属品による相場中央値への倍率、通常は 0.85〜1.1）、extra_cost_yen は写真から必要と分かった修理・部品の追加費用（円、なければ 0）。findings は写真・説明から読み取れた具体的事実を日本語で最大6件。advice は仕入れ判断の一言（30〜80字）。`;
const AI_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['revive_adjust', 'fake_risk', 'condition_grade', 'sale_multiplier', 'extra_cost_yen', 'findings', 'summary', 'advice'],
  properties: {
    revive_adjust: { type: 'integer', description: '復活確率への加減点（-60〜+30）' },
    fake_risk: { type: 'string', enum: ['low', 'medium', 'high'], description: '偽物リスク' },
    condition_grade: { type: 'string', enum: ['S', 'A', 'B', 'C', 'D'], description: '外観状態 S=新品同様 A=美品 B=通常中古 C=傷多い D=難あり' },
    sale_multiplier: { type: 'number', description: '相場中央値に対する売値倍率（0.5〜1.3）' },
    extra_cost_yen: { type: 'integer', description: '写真から必要と分かった追加修理・部品費（円）' },
    findings: { type: 'array', items: { type: 'string' }, description: '写真・説明から読み取れた事実（最大6件）' },
    summary: { type: 'string', description: '状態の要約（60字以内）' },
    advice: { type: 'string', description: '仕入れ判断の一言' },
  },
};
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|sonnet-5-5|fable-5-1)$/;

async function callClaude(set, content) {
  const headers = {
    'content-type': 'application/json', 'x-api-key': set.apiKey, 'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  const body = {
    model: set.model, max_tokens: 4000, system: AI_SYSTEM,
    output_config: { effort: set.effort || 'medium', format: { type: 'json_schema', schema: AI_SCHEMA } },
    messages: [{ role: 'user', content }],
  };
  if (FALLBACK_MODELS.test(set.model)) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text(); const err = new Error(`API ${r.status}: ${t.slice(0, 300)}`); err.status = r.status; err.body = t; throw err; }
  return r.json();
}
async function aiJudge(payload) {
  const set = await getSet();
  if (!set.apiKey) throw new Error('Claude APIキーが未設定です。拡張のアイコン →「設定」で登録してください。');
  const text = `【出品タイトル】${payload.title}\n【説明文】${(payload.desc || '').slice(0, 3000)}\n【価格】${payload.price}円（${payload.site}）\n【推定モデル】${payload.modelName || '不明'}（ムーブメント: ${payload.mvName}）\n【ルールベースの復活確率】${payload.ruleScore}%\n【写真】${payload.images.length}枚添付`;
  const mk = imgs => [...imgs.map(u => ({ type: 'image', source: { type: 'url', url: u } })), { type: 'text', text }];
  let j, usedImages = payload.images.slice(0, 4);
  try { j = await callClaude(set, mk(usedImages)); }
  catch (e) {
    // 画像URLが取得できない等の 400 は画像なしで再試行
    if (e.status === 400 && usedImages.length) { usedImages = []; j = await callClaude(set, mk([])); }
    else throw e;
  }
  if (j.stop_reason === 'refusal') throw new Error('AIが判定を見送りました（' + (j.stop_details?.category || 'refusal') + '）');
  const txt = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let out; try { out = JSON.parse(txt); } catch (_) { throw new Error('AIの応答を読めませんでした: ' + txt.slice(0, 200)); }
  out.revive_adjust = Math.max(-60, Math.min(30, Math.round(+out.revive_adjust || 0)));
  out.sale_multiplier = Math.max(.5, Math.min(1.3, +out.sale_multiplier || 1));
  out.extra_cost_yen = Math.max(0, Math.round(+out.extra_cost_yen || 0));
  out.model = j.model; out.usage = j.usage; out.imagesUsed = usedImages.length;
  return out;
}

// ── 仕入れ候補 ──────────────────────────────────────
async function saveCand(c) {
  const o = await chrome.storage.local.get(CAND_KEY); const list = o[CAND_KEY] || [];
  list.unshift(c); await chrome.storage.local.set({ [CAND_KEY]: list.slice(0, 500) });
  await chrome.action.setBadgeText({ text: String(list.length) }); await chrome.action.setBadgeBackgroundColor({ color: '#d9a847' });
  return list.length;
}
async function refreshBadge() { const o = await chrome.storage.local.get(CAND_KEY); const n = (o[CAND_KEY] || []).length; await chrome.action.setBadgeText({ text: n ? String(n) : '' }); await chrome.action.setBadgeBackgroundColor({ color: '#d9a847' }); }
chrome.runtime.onInstalled.addListener(refreshBadge); chrome.runtime.onStartup.addListener(refreshBadge);

// ── メッセージ ──────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const run = async () => {
    switch (msg?.type) {
      case 'GET_SET': return { ok: true, set: await getSet() };
      case 'FETCH_MARKET': return { ok: true, data: await fetchMarket(msg.model, !!msg.force) };
      case 'AI_JUDGE': return { ok: true, ai: await aiJudge(msg.payload) };
      case 'SAVE_CAND': return { ok: true, n: await saveCand(msg.cand) };
      case 'REFRESH_BADGE': await refreshBadge(); return { ok: true };
      case 'CLEAR_CACHE': await chrome.storage.local.remove(CACHE_KEY); return { ok: true };
      default: return { ok: false, error: 'unknown message' };
    }
  };
  run().then(sendResponse).catch(e => { console.error('[wsx]', e); sendResponse({ ok: false, error: String(e.message || e) }); });
  return true;
});
