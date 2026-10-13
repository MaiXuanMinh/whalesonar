/* WhaleSonar — giao diện */
const $ = (s, el = document) => el.querySelector(s);
const state = { rep: null, win: 'h24', tf: '1h', charts: {} };

// ---------- format helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function compact(n, prefix = '') {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e12) return s + prefix + (a / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return s + prefix + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return s + prefix + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return s + prefix + (a / 1e3).toFixed(1) + 'K';
  return s + prefix + a.toFixed(a < 10 ? 2 : 0);
}
const usd = (n) => compact(n, '$');
function price(p) {
  if (p == null || !isFinite(p)) return '—';
  if (p >= 1) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: p >= 1000 ? 2 : 4 });
  if (p >= 0.001) return '$' + p.toPrecision(4);
  // 0.000004175 → $0.0₅4175
  const str = p.toFixed(20).replace(/0+$/, '');
  const m = str.match(/^0\.(0+)(\d{1,4})/);
  if (!m) return '$' + p.toExponential(3);
  const sub = String(m[1].length).split('').map((d) => '₀₁₂₃₄₅₆₇₈₉'[d]).join('');
  return `$0.0${sub}${m[2]}`;
}
const pct = (n, d = 1) => (n == null || !isFinite(n) ? '—' : n.toFixed(d) + '%');
const short = (a) => (a && a.length > 14 ? a.slice(0, 6) + '…' + a.slice(-4) : a || '—');
function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return Math.max(0, Math.floor(s)) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'p';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
function duration(ms) {
  const h = ms / 3_600_000;
  if (h < 1) return Math.round(ms / 60000) + ' phút';
  if (h < 48) return h.toFixed(1) + ' giờ';
  return Math.floor(h / 24) + ' ngày';
}
const chg = (v) => (v == null ? '<span class="muted">—</span>' : `<b class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(2)}%</b>`);
const signedUsd = (v) => `<span class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : '−'}${usd(Math.abs(v))}</span>`;
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function explorer(kind, a) {
  const c = state.rep.chain;
  if (!c.explorer || !a) return null;
  if (c.solana) return `${c.explorer}/${kind === 'addr' ? 'account' : kind}/${a}`;
  return `${c.explorer}/${kind === 'addr' ? 'address' : kind}/${a}`;
}
const addrLink = (a, label) => {
  const u = explorer('addr', a);
  return u ? `<a class="mono" href="${esc(u)}" target="_blank" rel="noopener" title="${esc(a)}">${esc(label || short(a))}</a>` : `<span class="mono">${esc(short(a))}</span>`;
};

// ---------- theme ----------
function applyTheme(t) {
  if (t) document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}
try { applyTheme(localStorage.getItem('ws-theme')); } catch {}
$('#themeBtn').onclick = () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
    (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  const t = dark ? 'light' : 'dark';
  applyTheme(t);
  try { localStorage.setItem('ws-theme', t); } catch {}
  if (state.rep) drawCharts();
};

// ---------- recent ----------
function getRecent() { try { return JSON.parse(localStorage.getItem('ws-recent') || '[]'); } catch { return []; } }
function pushRecent(rep) {
  const list = getRecent().filter((r) => r.address.toLowerCase() !== rep.token.address.toLowerCase());
  list.unshift({ address: rep.token.address, symbol: rep.token.symbol, chain: rep.chain.name, chainId: rep.chain.id });
  try { localStorage.setItem('ws-recent', JSON.stringify(list.slice(0, 8))); } catch {}
  renderRecent();
}
function renderRecent() {
  $('#recent').innerHTML = getRecent().map((r) => `<span class="chip" data-a="${esc(r.address)}" data-c="${esc(r.chainId || '')}">${esc(r.symbol)} · ${esc(r.chain)}</span>`).join('');
}
$('#recent').onclick = (e) => {
  const c = e.target.closest('.chip');
  if (c) analyzeAddress(c.dataset.a, c.dataset.c);
};
renderRecent();

// ---------- tìm kiếm: địa chỉ hoặc mã token ----------
const isAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(s) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const sg = { items: [], active: -1, timer: null, seq: 0 };

function analyzeAddress(address, chain) {
  $('#addr').value = address;
  syncClear();
  state.query = { address, chain: chain || '' };
  hideSuggest();
  run();
}

$('#searchForm').onsubmit = (e) => { e.preventDefault(); submitSearch(); };
function submitSearch() {
  clearTimeout(sg.timer);
  const v = $('#addr').value.trim();
  if (!v) return;
  if (!$('#suggest').classList.contains('hidden') && sg.items.length) return pickSuggest(Math.max(0, sg.active));
  if (isAddress(v)) return analyzeAddress(v);
  searchSymbol(v, true);
}

// nút ✕: xoá sạch ô tìm kiếm chỉ với 1 lần bấm
const syncClear = () => $('#clearBtn').classList.toggle('hidden', !$('#addr').value);
$('#clearBtn').addEventListener('click', () => {
  clearTimeout(sg.timer);
  sg.items = []; sg.seq++;
  $('#addr').value = '';
  syncClear();
  hideSuggest();
  $('#addr').focus();
});

$('#addr').addEventListener('input', () => {
  syncClear();
  const v = $('#addr').value.trim();
  clearTimeout(sg.timer);
  sg.items = []; sg.seq++;
  if (v.length < 2 || isAddress(v)) return hideSuggest();
  sg.timer = setTimeout(() => searchSymbol(v), 350);
});
$('#addr').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); return submitSearch(); }
  if ($('#suggest').classList.contains('hidden') || !sg.items.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = sg.items.length;
    sg.active = (sg.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    renderSuggest();
  } else if (e.key === 'Escape') hideSuggest();
});
$('#addr').addEventListener('focus', () => { if (sg.items.length && !isAddress($('#addr').value.trim())) showSuggest(); });
document.addEventListener('click', (e) => { if (!e.target.closest('.search-box')) hideSuggest(); });
$('#suggest').addEventListener('click', (e) => {
  const el = e.target.closest('.sg');
  if (el) pickSuggest(Number(el.dataset.i));
});

async function searchSymbol(q, fromSubmit) {
  const my = ++sg.seq;
  $('#suggest').innerHTML = '<div class="msg">Đang tìm…</div>';
  showSuggest();
  try {
    const data = await WS.searchTokens(q);
    if (my !== sg.seq) return;
    sg.items = data;
    sg.active = fromSubmit && data.length ? 0 : -1;
    if (!data.length) { $('#suggest').innerHTML = `<div class="msg">Không tìm thấy token nào khớp "${esc(q)}".</div>`; return; }
    renderSuggest();
  } catch (err) {
    if (my === sg.seq) $('#suggest').innerHTML = `<div class="msg">Lỗi tìm kiếm: ${esc(err.message)}</div>`;
  }
}

function renderSuggest() {
  $('#suggest').innerHTML = sg.items.map((t, i) => `
    <div class="sg ${i === sg.active ? 'active' : ''}" data-i="${i}" role="option" aria-selected="${i === sg.active}">
      ${t.image ? `<img src="${esc(t.image)}" alt="" loading="lazy">` : `<div class="ph">${esc((t.symbol || '?').slice(0, 3))}</div>`}
      <div style="min-width:0">
        <div class="nm">${esc(t.symbol)}<small>${esc(t.name)}</small></div>
        <div class="meta">${esc(t.chain)} · <span class="mono">${esc(short(t.address))}</span> · ${t.pools} pool</div>
      </div>
      <div class="rt">
        <div>${price(t.priceUsd)} ${t.priceChange24h != null ? `<span class="${t.priceChange24h >= 0 ? 'up' : 'down'}">${t.priceChange24h >= 0 ? '+' : ''}${Number(t.priceChange24h).toFixed(1)}%</span>` : ''}</div>
        <div>Vol ${usd(t.volume24h)} · MC ${usd(t.marketCap)}</div>
      </div>
    </div>`).join('');
  $('#suggest').querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}
function pickSuggest(i) {
  const t = sg.items[i];
  if (t) analyzeAddress(t.address, t.chainId);
}
function showSuggest() { $('#suggest').classList.remove('hidden'); $('#addr').setAttribute('aria-expanded', 'true'); }
function hideSuggest() { $('#suggest').classList.add('hidden'); $('#addr').setAttribute('aria-expanded', 'false'); }

// ---------- load ----------
async function run(pair) {
  const { address, chain } = state.query || {};
  if (!address) return;
  history.replaceState(null, '', '?' + new URLSearchParams(chain ? { a: address, c: chain } : { a: address }));
  show('loading');
  $('#goBtn').disabled = true;
  try {
    const data = await WS.analyze(address, { chain, pair });
    state.rep = data;
    state.query = { address: data.token.address, chain: data.chain.id };
    state.tf = '1h';
    render();
    pushRecent(data);
    show('report');
  } catch (err) {
    $('#error').innerHTML = `<b>Không phân tích được token.</b><br>${esc(err.message)}`;
    show('error');
  } finally {
    $('#goBtn').disabled = false;
  }
}
function show(id) {
  for (const s of ['empty', 'loading', 'error', 'report']) $('#' + s).classList.toggle('hidden', s !== id);
}

// ---------- render ----------
const STATUS = {
  good: { color: '--good', icon: '✓' },
  warning: { color: '--warning', icon: '!' },
  serious: { color: '--serious', icon: '!' },
  critical: { color: '--critical', icon: '✕' },
};

function render() {
  const r = state.rep;
  const m = r.market;
  const a = r.analysis;
  const st = STATUS[a.level];
  const t = r.token;
  const circ = 2 * Math.PI * 46;

  $('#report').innerHTML = `
  <div class="grid g-hero">
    <div class="card">
      <div class="token-head">
        ${t.image ? `<img src="${esc(t.image)}" alt="">` : `<div class="ph">${esc((t.symbol || '?').slice(0, 2))}</div>`}
        <div style="min-width:0">
          <h1>${esc(t.name)} <span class="sym">${esc(t.symbol)}</span></h1>
          <div class="badges">
            <span class="badge">${esc(r.chain.name)}</span>
            <span class="badge copy mono" data-copy="${esc(t.address)}" title="Bấm để copy">${esc(short(t.address))} ⧉</span>
            ${r.otherChains.length ? `<span class="badge" title="Cùng địa chỉ cũng có trên chain khác">+${r.otherChains.map(esc).join(', ')}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="price-row">
        <span class="price num">${price(m.priceUsd)}</span>
        <div class="changes">
          <span>5p ${chg(m.priceChange.m5)}</span><span>1h ${chg(m.priceChange.h1)}</span>
          <span>6h ${chg(m.priceChange.h6)}</span><span>24h ${chg(m.priceChange.h24)}</span>
        </div>
      </div>
      <div class="pair-select">
        <span>Pool phân tích:</span>
        <select id="pairSel">${r.pairs.map((p) => `<option value="${esc(p.address)}" ${p.address === r.mainPair.address ? 'selected' : ''}>${esc(p.label)} · ${esc(p.dex)} · TK ${usd(p.liquidityUsd)}</option>`).join('')}</select>
      </div>
      <div class="links">
        <a href="${esc(r.mainPair.url)}" target="_blank" rel="noopener">DexScreener ↗</a>
        ${explorer('token', t.address) ? `<a href="${esc(explorer('token', t.address))}" target="_blank" rel="noopener">Explorer ↗</a>` : ''}
        ${r.mainPair.gtNetwork ? `<a href="https://www.geckoterminal.com/${esc(r.mainPair.gtNetwork)}/pools/${esc(r.mainPair.address)}" target="_blank" rel="noopener">GeckoTerminal ↗</a>` : ''}
        ${t.websites.map((w) => `<a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.label || 'Website')} ↗</a>`).join('')}
        ${t.socials.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.type)} ↗</a>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="verdict">
        <div class="gauge" role="img" aria-label="Điểm rủi ro ${a.risk} trên 100">
          <svg viewBox="0 0 112 112"><circle cx="56" cy="56" r="46" fill="none" stroke="var(--grid)" stroke-width="10"/>
            <circle cx="56" cy="56" r="46" fill="none" stroke="var(${st.color})" stroke-width="10" stroke-linecap="round"
              stroke-dasharray="${(circ * a.risk) / 100} ${circ}"/></svg>
          <div class="val"><div><b class="num">${a.risk}</b><small>/100 rủi ro</small></div></div>
        </div>
        <div>
          <span class="status"><span class="dot" style="background:var(${st.color})">${st.icon}</span>${esc(a.levelText)}</span>
          <p>${esc(a.summary)}</p>
        </div>
      </div>
      <div class="findings">
        <div><h3>Điểm tốt</h3><ul class="pos">${list(a.positives, '✓', 'Không có')}</ul></div>
        <div><h3>Rủi ro</h3><ul class="neg">${list(a.negatives, '✕', 'Không phát hiện')}</ul></div>
        <div><h3>Ghi chú</h3><ul class="note">${list(a.notes, '•', '—')}</ul></div>
      </div>
    </div>
  </div>

  <section class="block tiles">
    ${tile('Market cap', usd(m.marketCap), m.fdv && m.fdv !== m.marketCap ? 'FDV ' + usd(m.fdv) : '')}
    ${tile('Thanh khoản', usd(m.liquidityUsd), r.pairs.length + ' pool')}
    ${tile('Volume 24h', usd(m.dexTotals.h24.volume), m.liquidityUsd ? (m.dexTotals.h24.volume / m.liquidityUsd).toFixed(2) + '× thanh khoản' : '')}
    ${tile('Holders', r.token.holderCount != null ? r.token.holderCount.toLocaleString('vi') : '—', r.holders ? 'Top 10: ' + pct(r.holders.top10Pct) : '')}
    ${tile('Tuổi pool', m.ageDays != null ? duration(m.ageDays * 86_400_000) : '—', m.pairCreatedAt ? new Date(m.pairCreatedAt).toLocaleDateString('vi') : '')}
    ${tile('Ngưỡng cá voi', '≥ ' + usd(r.whaleUsd), 'Tự động (top 5% lệnh)')}
  </section>

  <section class="block card">
    <div class="card-head">
      <div><h2>Lượng mua / bán theo khung thời gian</h2><p class="sub">Số lệnh từ tất cả pool (DexScreener). Giá trị USD & cá voi tính từ lịch sử giao dịch pool chính.</p></div>
      <div class="tabs" id="winTabs">${r.flow.windows.map((w) => `<button data-w="${w.key}" class="${w.key === state.win ? 'on' : ''}">${w.label}</button>`).join('')}</div>
    </div>
    <div id="winTiles" class="tiles"></div>
    <div class="grid g-2" style="margin-top:18px">
      <div>
        <h2 style="font-size:13px;margin:0 0 10px">Áp lực mua – bán</h2>
        <div class="pressure">${r.flow.windows.map(pressureRow).join('')}</div>
      </div>
      <div>
        <div class="card-head" style="margin-bottom:6px">
          <h2 style="font-size:13px;margin:0">Dòng tiền theo thời gian (USD)</h2>
          <div class="legend"><span><i class="sw buy"></i>Mua (trên)</span><span><i class="sw sell"></i>Bán (dưới)</span></div>
        </div>
        <div class="chart-box" style="height:230px"><canvas id="flowChart"></canvas></div>
        <p class="note">${flowNote()}</p>
      </div>
    </div>
  </section>

  <section class="block card">
    <div class="card-head">
      <div><h2>Giá ${esc(t.symbol)} (USD)</h2><p class="sub">Pool ${esc(r.mainPair.label)} · ${esc(r.mainPair.dex)}</p></div>
      <div class="tabs" id="tfTabs">${['15m', '1h', '4h', '1d'].map((x) => `<button data-tf="${x}" class="${x === state.tf ? 'on' : ''}">${x}</button>`).join('')}</div>
    </div>
    <div class="chart-box"><canvas id="priceChart"></canvas></div>
    <h2 style="font-size:12.5px;margin:10px 0 4px;color:var(--muted);font-weight:500">Volume (USD)</h2>
    <div class="chart-box sm"><canvas id="volChart"></canvas></div>
  </section>

  <div class="grid g-2 block">
    ${holdersCard()}
    ${whalesCard()}
  </div>

  <section class="block card">
    <div class="card-head"><div><h2>Giao dịch cá voi gần đây</h2><p class="sub">Các lệnh ≥ ${usd(r.whaleUsd)} trên pool chính</p></div></div>
    ${tradesTable(r.whaleTrades, 'Chưa có lệnh nào vượt ngưỡng cá voi trong dữ liệu gần đây.')}
  </section>

  ${securityCard()}

  ${r.warnings.length ? `<div class="warn-box">⚠ ${r.warnings.map(esc).join('<br>⚠ ')}</div>` : ''}
  <p class="note">Báo cáo tạo lúc ${new Date(r.generatedAt).toLocaleString('vi')}. Dữ liệu holder từ GoPlus (top 10), giao dịch từ GeckoTerminal (tối đa 300 lệnh mới nhất + 300 lệnh cá voi).</p>
  `;

  renderWindow();
  drawCharts();

  $('#winTabs').onclick = (e) => { const w = e.target.dataset.w; if (!w) return; state.win = w; renderWindow(); };
  $('#tfTabs').onclick = (e) => { const tf = e.target.dataset.tf; if (tf) loadOhlcv(tf); };
  $('#pairSel').onchange = (e) => run(e.target.value);
  $('#report').querySelectorAll('[data-copy]').forEach((el) => (el.onclick = () => {
    navigator.clipboard?.writeText(el.dataset.copy);
    const old = el.textContent; el.textContent = 'Đã copy ✓'; setTimeout(() => (el.textContent = old), 1200);
  }));
}

const list = (arr, icon, empty) => (arr.length ? arr.map((x) => `<li><i>${icon}</i><span>${esc(x)}</span></li>`).join('') : `<li class="muted"><i></i>${empty}</li>`);
const tile = (k, v, d = '', sw = '') => `<div class="tile"><div class="k">${sw}${k}</div><div class="v num">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;

function renderWindow() {
  const r = state.rep;
  const w = r.flow.windows.find((x) => x.key === state.win);
  $('#winTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.w === state.win));
  const est = w.estimated ? ' <span title="Ước tính: tỷ lệ mua/bán từ mẫu giao dịch × tổng volume thật">(ước tính)</span>' : '';
  const whaleNet = w.whaleBuyUsd - w.whaleSellUsd;
  $('#winTiles').innerHTML = [
    tile('Lệnh mua', w.buys.toLocaleString('vi'), w.uniqueBuyers != null ? w.uniqueBuyers + ' ví mua (pool chính)' : '', '<i class="sw buy"></i>'),
    tile('Lệnh bán', w.sells.toLocaleString('vi'), w.uniqueSellers != null ? w.uniqueSellers + ' ví bán (pool chính)' : '', '<i class="sw sell"></i>'),
    tile('Giá trị mua', usd(w.buyUsd), 'Volume tổng ' + usd(w.volume) + est, '<i class="sw buy"></i>'),
    tile('Giá trị bán', usd(w.sellUsd), est ? 'Ước tính từ mẫu' : '', '<i class="sw sell"></i>'),
    tile('Dòng tiền ròng', signedUsd(w.netUsd), w.netUsd >= 0 ? 'Mua > bán' : 'Bán > mua'),
    ...(w.whaleOk ? [
      tile('% mua từ cá voi', pct(w.whaleBuyShare, 0), `${w.whaleBuyCount} lệnh · ${usd(w.whaleBuyUsd)}`),
      tile('% bán từ cá voi', pct(w.whaleSellShare, 0), `${w.whaleSellCount} lệnh · ${usd(w.whaleSellUsd)}`),
      tile('Cá voi ròng', signedUsd(whaleNet), `${w.whaleWallets} ví cá voi${w.whaleExact ? '' : ' (dữ liệu chưa đủ)'}`),
    ] : [tile('Cá voi', '—', 'Chưa lấy được dữ liệu (API giới hạn tốc độ) — bấm Phân tích lại sau ít phút')]),
  ].join('');
}

function pressureRow(w) {
  const bar = (b, s, fmt) => {
    const tot = b + s;
    if (!tot) return `<div class="pbar"><div class="e">Không có giao dịch</div></div>`;
    const bp = (b / tot) * 100;
    return `<div class="pbar" title="Mua ${fmt(b)} · Bán ${fmt(s)}">
      <div class="b" style="width:${bp}%">${bp >= 18 ? 'Mua ' + bp.toFixed(0) + '%' : ''}</div>
      <div class="s" style="width:${100 - bp}%">${100 - bp >= 18 ? 'Bán ' + (100 - bp).toFixed(0) + '%' : ''}</div></div>`;
  };
  return `<div class="prow"><div class="lbl">${w.label}</div><div class="pbars">
    <div class="pbar-line"><span>Số lệnh</span>${bar(w.buys, w.sells, (n) => n.toLocaleString('vi') + ' lệnh')}</div>
    <div class="pbar-line"><span>USD</span>${bar(w.buyUsd, w.sellUsd, usd)}</div>
  </div></div>`;
}

function flowNote() {
  const f = state.rep.flow;
  if (!f.sampleSize) return 'Không có dữ liệu giao dịch.';
  return `Dựa trên ${f.sampleSize} lệnh gần nhất của pool chính, phủ ${duration(f.sampleCoverMs)}${f.sampleComplete ? ' (đầy đủ 24h)' : ''}. Mỗi cột = ${Math.round(f.bucketMs / 60000)} phút.`;
}

function holdersCard() {
  const h = state.rep.holders;
  if (!h) return `<section class="card"><h2>Top holder</h2><p class="sub">Không có dữ liệu holder cho token này.</p></section>`;
  const typeName = { lp: 'LP/Pool', burn: 'Burn', cex: 'CEX', locked: 'Khoá', contract: 'Contract', wallet: '' };
  const max = Math.max(...h.top.map((x) => x.pct), 1);
  const lpPct = h.top.filter((x) => x.type === 'lp').reduce((s, x) => s + x.pct, 0);
  const otherPct = h.top.filter((x) => ['burn', 'cex', 'locked'].includes(x.type)).reduce((s, x) => s + x.pct, 0);
  const realPct = h.top10RealPct;
  const restPct = Math.max(0, 100 - lpPct - otherPct - realPct);
  const seg = (v, c, label) => (v > 0 ? `<div style="width:${v}%;background:var(${c})" title="${label}: ${v.toFixed(2)}%"></div>` : '');
  return `<section class="card">
    <h2>Top holder & mức độ tập trung</h2>
    <p class="sub">${h.count != null ? h.count.toLocaleString('vi') + ' holder · ' : ''}Top 10 nắm ${pct(h.top10Pct)} (không tính LP/burn/CEX: ${pct(realPct)})</p>
    <div class="compo" role="img" aria-label="Phân bổ nguồn cung">${seg(realPct, '--s1', 'Top ví')}${seg(lpPct, '--s2', 'LP')}${seg(otherPct, '--s3', 'Burn/CEX/Khoá')}${seg(restPct, '--grid', 'Còn lại')}</div>
    <div class="legend" style="margin-bottom:14px">
      <span><i class="sw" style="background:var(--s1)"></i>Ví top 10 ${pct(realPct)}</span>
      <span><i class="sw" style="background:var(--s2)"></i>LP ${pct(lpPct)}</span>
      <span><i class="sw" style="background:var(--s3)"></i>Burn/CEX/Khoá ${pct(otherPct)}</span>
      <span><i class="sw" style="background:var(--grid)"></i>Còn lại ${pct(restPct)}</span>
    </div>
    <div class="hlist">${h.top.map((x, i) => `
      <div class="hrow ${x.type}">
        <span class="rk">${i + 1}</span>
        <span class="ad">${addrLink(x.address)}${typeName[x.type] ? `<span class="tag">${typeName[x.type]}</span>` : ''}${x.tag ? `<span class="tag">${esc(x.tag)}</span>` : ''}</span>
        <span class="htrack"><span class="hfill" style="width:${(x.pct / max) * 100}%"></span></span>
        <span class="pc num">${x.pct.toFixed(2)}%</span>
      </div>`).join('')}</div>
    <div class="tiles" style="margin-top:14px">
      ${tile('Ví lớn nhất', pct(h.biggestRealPct, 2), 'không tính LP/burn/CEX')}
      ${tile('Creator giữ', pct(h.creatorPct, 2), h.creatorAddress ? addrLink(h.creatorAddress) : '')}
      ${tile('LP khoá/burn', pct(h.lpLockedPct, 0), h.lpLockedPct == null ? 'Không có dữ liệu (V3/CLMM)' : '')}
    </div>
  </section>`;
}

function whalesCard() {
  const r = state.rep;
  const rows = r.wallets;
  return `<section class="card">
    <h2>Ví giao dịch nhiều nhất (24h)</h2>
    <p class="sub">Xếp theo tổng giá trị mua + bán trên pool chính · <span class="whale-badge">🐋</span> = có lệnh ≥ ${usd(r.whaleUsd)}</p>
    ${rows.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>Ví</th><th class="r">Mua</th><th class="r">Bán</th><th class="r">Ròng</th><th class="r">Lệnh</th><th class="r">Gần nhất</th></tr></thead>
      <tbody>${rows.map((w) => `<tr>
        <td>${addrLink(w.wallet)}${w.isWhale ? '<span class="whale-badge">🐋</span>' : ''}${w.holder ? `<span class="tag" title="Nằm trong top holder">Holder #${w.holder.rank}</span>` : ''}</td>
        <td class="r num">${usd(w.buyUsd)}</td><td class="r num">${usd(w.sellUsd)}</td>
        <td class="r num">${signedUsd(w.netUsd)}</td>
        <td class="r num">${w.buys}/${w.sells}</td><td class="r muted">${ago(w.last)}</td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted">Không có dữ liệu giao dịch.</p>'}
  </section>`;
}

function tradesTable(trades, empty) {
  if (!trades.length) return `<p class="muted">${empty}</p>`;
  return `<div class="tbl-wrap"><table>
    <thead><tr><th>Thời gian</th><th>Loại</th><th class="r">Giá trị</th><th class="r">Số token</th><th class="r">Giá</th><th>Ví</th><th>Tx</th></tr></thead>
    <tbody>${trades.map((t) => `<tr>
      <td class="muted">${ago(t.ts)} trước</td>
      <td><span class="kind ${t.kind}"><i class="sw ${t.kind}"></i>${t.kind === 'buy' ? 'Mua' : 'Bán'}</span></td>
      <td class="r num"><b>${usd(t.usd)}</b></td><td class="r num">${compact(t.amount)}</td>
      <td class="r num">${price(t.price)}</td><td>${addrLink(t.wallet)}</td>
      <td>${explorer('tx', t.tx) ? `<a class="mono" href="${esc(explorer('tx', t.tx))}" target="_blank" rel="noopener">${esc(short(t.tx))}</a>` : ''}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

function securityCard() {
  const s = state.rep.security;
  if (!s.length) return `<section class="block card"><h2>Bảo mật contract</h2><p class="sub">Không có dữ liệu bảo mật từ GoPlus cho token/chain này.</p></section>`;
  const icon = { good: '✓', warn: '!', bad: '✕', na: '?' };
  const order = { bad: 0, warn: 1, good: 2, na: 3 };
  const cnt = (k) => s.filter((x) => x.status === k).length;
  return `<section class="block card">
    <div class="card-head"><div><h2>Bảo mật contract</h2><p class="sub">Kiểm tra bởi GoPlus Security</p></div>
      <div class="sec-sum"><span>✕ ${cnt('bad')} nguy hiểm</span><span>! ${cnt('warn')} cảnh báo</span><span>✓ ${cnt('good')} an toàn</span></div></div>
    <div class="sec-grid">${[...s].sort((a, b) => order[a.status] - order[b.status]).map((x) => `
      <div class="sec st-${x.status}"><span class="ic">${icon[x.status]}</span><div><b>${esc(x.label)}</b><span>${esc(x.detail)}</span></div></div>`).join('')}</div>
  </section>`;
}

// ---------- charts ----------
function chartBase() {
  const muted = cssVar('--muted'), grid = cssVar('--grid'), text = cssVar('--text');
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.color = muted;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cssVar('--surface'), titleColor: text, bodyColor: text,
        borderColor: cssVar('--border') || grid, borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: cssVar('--axis') }, ticks: { maxRotation: 0, autoSkipPadding: 18 } },
      y: { grid: { color: grid }, border: { display: false }, ticks: { maxTicksLimit: 5 } },
    },
  };
}

function timeLabel(ts, span) {
  const d = new Date(ts);
  if (span > 3 * 86_400_000) return d.toLocaleDateString('vi', { day: '2-digit', month: '2-digit' });
  return d.toLocaleTimeString('vi', { hour: '2-digit', minute: '2-digit' });
}

function drawCharts() {
  for (const c of Object.values(state.charts)) c.destroy();
  state.charts = {};
  drawFlow();
  drawPrice();
}

function drawFlow() {
  const f = state.rep.flow;
  const el = $('#flowChart');
  if (!el || !f.series.length) return;
  const base = chartBase();
  const buy = cssVar('--buy'), sell = cssVar('--sell');
  const labels = f.series.map((b) => timeLabel(b.t, 0));
  state.charts.flow = new Chart(el, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Mua', data: f.series.map((b) => b.buyUsd), backgroundColor: buy, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', stack: 's' },
        { label: 'Bán', data: f.series.map((b) => -b.sellUsd), backgroundColor: sell, borderRadius: { bottomLeft: 4, bottomRight: 4 }, borderSkipped: 'top', stack: 's' },
      ],
    },
    options: {
      ...base,
      datasets: { bar: { categoryPercentage: 0.8, barPercentage: 0.9 } },
      plugins: {
        ...base.plugins,
        tooltip: {
          ...base.plugins.tooltip,
          callbacks: {
            label: (c) => {
              const b = f.series[c.dataIndex];
              return c.datasetIndex === 0 ? ` Mua ${usd(b.buyUsd)} (${b.buys} lệnh)` : ` Bán ${usd(b.sellUsd)} (${b.sells} lệnh)`;
            },
            footer: (items) => { const b = f.series[items[0].dataIndex]; return 'Ròng ' + (b.buyUsd - b.sellUsd >= 0 ? '+' : '−') + usd(Math.abs(b.buyUsd - b.sellUsd)); },
          },
        },
      },
      scales: {
        x: { ...base.scales.x, stacked: true },
        y: { ...base.scales.y, stacked: true, ticks: { ...base.scales.y.ticks, callback: (v) => usd(Math.abs(v)) } },
      },
    },
  });
}

function drawPrice() {
  const data = state.rep.ohlcv;
  const el = $('#priceChart');
  if (!el) return;
  if (!data.length) { el.parentElement.innerHTML = '<p class="muted">Không có dữ liệu nến giá.</p>'; return; }
  const base = chartBase();
  const span = data.at(-1).t - data[0].t;
  const labels = data.map((d) => timeLabel(d.t, span));
  const lineColor = cssVar('--s1');
  const fullTime = (i) => new Date(data[i].t).toLocaleString('vi');

  state.charts.price = new Chart(el, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Giá', data: data.map((d) => d.c), borderColor: lineColor, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBorderColor: cssVar('--surface'), pointHoverBackgroundColor: lineColor, tension: 0.15, fill: { target: 'origin', above: lineColor + '14' } }] },
    options: {
      ...base,
      plugins: {
        ...base.plugins,
        tooltip: { ...base.plugins.tooltip, callbacks: {
          title: (it) => fullTime(it[0].dataIndex),
          label: (c) => { const d = data[c.dataIndex]; return [` Đóng ${price(d.c)}`, ` Cao ${price(d.h)} · Thấp ${price(d.l)}`, ` Volume ${usd(d.v)}`]; },
        } },
      },
      scales: { x: base.scales.x, y: { ...base.scales.y, beginAtZero: false, ticks: { ...base.scales.y.ticks, callback: (v) => price(v) } } },
    },
    plugins: [crosshair()],
  });

  state.charts.vol = new Chart($('#volChart'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Volume', data: data.map((d) => d.v), backgroundColor: cssVar('--axis'), hoverBackgroundColor: lineColor, borderRadius: { topLeft: 2, topRight: 2 }, borderSkipped: 'bottom', categoryPercentage: 0.9, barPercentage: 0.9 }] },
    options: {
      ...base,
      plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: { title: (it) => fullTime(it[0].dataIndex), label: (c) => ' Volume ' + usd(c.raw) } } },
      scales: { x: { ...base.scales.x, ticks: { display: false } }, y: { ...base.scales.y, ticks: { maxTicksLimit: 3, callback: (v) => usd(v) } } },
    },
  });
}

function crosshair() {
  return {
    id: 'crosshair',
    afterDatasetsDraw(chart) {
      const a = chart.tooltip?.getActiveElements?.();
      if (!a || !a.length) return;
      const x = a[0].element.x, { top, bottom } = chart.chartArea, ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = cssVar('--axis');
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.restore();
    },
  };
}

async function loadOhlcv(tf) {
  const r = state.rep;
  state.tf = tf;
  $('#tfTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tf === tf));
  try {
    r.ohlcv = await WS.fetchOhlcv(r.mainPair.gtNetwork, r.mainPair.address, r.token.address, tf);
    state.charts.price?.destroy(); state.charts.vol?.destroy();
    drawPrice();
  } catch (e) {
    console.error(e);
  }
}

// giữ server sống khi chạy từ icon desktop (chỉ khi mở qua localhost)
if (location.hostname === 'localhost') {
  const ping = () => fetch('/api/ping').catch(() => {});
  ping();
  setInterval(ping, 20_000);
}

// PWA: cho phép cài lên màn hình chính & mở nhanh khi mạng yếu
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// mở sẵn từ URL ?a=
const pre = new URLSearchParams(location.search).get('a');
if (pre) analyzeAddress(pre, new URLSearchParams(location.search).get('c'));
