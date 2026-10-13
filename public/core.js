/* WhaleSonar — lõi phân tích, chạy hoàn toàn trong trình duyệt.
 * Nguồn dữ liệu: DexScreener (giá, thanh khoản, số lệnh), GoPlus (bảo mật, top holder),
 * GeckoTerminal (lịch sử giao dịch, nến giá). Cả ba đều cho phép gọi trực tiếp từ trình duyệt.
 */
(function () {
'use strict';

const CHAINS = {
  ethereum: { name: 'Ethereum', gp: '1', gt: 'eth', explorer: 'https://etherscan.io' },
  bsc: { name: 'BNB Chain', gp: '56', gt: 'bsc', explorer: 'https://bscscan.com' },
  base: { name: 'Base', gp: '8453', gt: 'base', explorer: 'https://basescan.org' },
  arbitrum: { name: 'Arbitrum', gp: '42161', gt: 'arbitrum', explorer: 'https://arbiscan.io' },
  polygon: { name: 'Polygon', gp: '137', gt: 'polygon_pos', explorer: 'https://polygonscan.com' },
  optimism: { name: 'Optimism', gp: '10', gt: 'optimism', explorer: 'https://optimistic.etherscan.io' },
  avalanche: { name: 'Avalanche', gp: '43114', gt: 'avax', explorer: 'https://snowtrace.io' },
  linea: { name: 'Linea', gp: '59144', gt: 'linea', explorer: 'https://lineascan.build' },
  blast: { name: 'Blast', gp: '81457', gt: 'blast', explorer: 'https://blastscan.io' },
  sonic: { name: 'Sonic', gp: '146', gt: 'sonic', explorer: 'https://sonicscan.org' },
  zksync: { name: 'zkSync', gp: '324', gt: 'zksync', explorer: 'https://explorer.zksync.io' },
  mantle: { name: 'Mantle', gp: '5000', gt: 'mantle', explorer: 'https://mantlescan.xyz' },
  cronos: { name: 'Cronos', gp: '25', gt: 'cro', explorer: 'https://cronoscan.com' },
  solana: { name: 'Solana', gp: 'solana', gt: 'solana', explorer: 'https://solscan.io', solana: true },
  tron: { name: 'Tron', gp: 'tron', gt: 'tron', explorer: 'https://tronscan.org/#' },
};

const BURN_ADDRS = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
  '0xdead000000000000000042069420694206942069',
  '1nc1nerator11111111111111111111111111111111',
]);

// ---------- fetch helpers ----------
const cache = new Map();
async function getJSON(url, ttlMs = 60_000, retries = 2) {
  const hit = cache.get(url);
  if (hit && hit.exp > Date.now()) return hit.data;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: ctrl.signal });
    if (res.status === 429 && retries > 0) {
      // Bị giới hạn tốc độ → chờ rồi thử lại
      clearTimeout(timer);
      await new Promise((r) => setTimeout(r, 2500));
      return getJSON(url, ttlMs, retries - 1);
    }
    if (res.status === 429) throw new Error(`${new URL(url).host} đang giới hạn tốc độ, thử lại sau ít phút`);
    if (!res.ok) throw new Error(`HTTP ${res.status} từ ${new URL(url).host}`);
    const data = await res.json();
    cache.set(url, { data, exp: Date.now() + ttlMs });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// GeckoTerminal giới hạn ~30 request/phút → xếp hàng, cách nhau tối thiểu 400ms
let gtQueue = Promise.resolve();
function gtJSON(pathname, ttlMs) {
  const url = 'https://api.geckoterminal.com/api/v2' + pathname;
  if (cache.get(url)?.exp > Date.now()) return getJSON(url, ttlMs);
  const p = gtQueue.then(() => getJSON(url, ttlMs));
  gtQueue = p.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 400)));
  return p;
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const lc = (s) => (s || '').toLowerCase();
const sameAddr = (a, b, sol) => (sol ? a === b : lc(a) === lc(b));

// ---------- main analysis ----------
async function analyze(address, opts = {}) {
  address = address.trim();
  const ds = await getJSON(`https://api.dexscreener.com/latest/dex/tokens/${address}`, 30_000);
  let pairs = ds.pairs || [];
  if (!pairs.length) throw new Error('Không tìm thấy token này trên DEX nào (DexScreener). Kiểm tra lại địa chỉ.');

  // Chọn chain có tổng thanh khoản lớn nhất (hoặc chain được yêu cầu)
  const liqByChain = {};
  for (const p of pairs) liqByChain[p.chainId] = (liqByChain[p.chainId] || 0) + (p.liquidity?.usd || 0);
  const chainId = opts.chain && liqByChain[opts.chain] !== undefined
    ? opts.chain
    : Object.entries(liqByChain).sort((a, b) => b[1] - a[1])[0][0];
  const chain = CHAINS[chainId] || { name: chainId, explorer: null };
  const sol = !!chain.solana;
  pairs = pairs.filter((p) => p.chainId === chainId).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));

  const tokenIsBase = (p) => sameAddr(p.baseToken.address, address, sol);
  const ref = pairs.find(tokenIsBase) || pairs[0];
  const tokenMeta = tokenIsBase(ref) ? ref.baseToken : ref.quoteToken;
  const canonicalAddr = tokenMeta.address;

  const mainPair = (opts.pair && pairs.find((p) => lc(p.pairAddress) === lc(opts.pair))) || pairs.find(tokenIsBase) || pairs[0];

  // Tổng hợp số lệnh mua/bán + volume trên tất cả các pool
  const W = ['m5', 'h1', 'h6', 'h24'];
  const dexTotals = {};
  for (const w of W) dexTotals[w] = { buys: 0, sells: 0, volume: 0 };
  for (const p of pairs) {
    const base = tokenIsBase(p);
    for (const w of W) {
      const t = p.txns?.[w] || {};
      dexTotals[w].buys += (base ? t.buys : t.sells) || 0;
      dexTotals[w].sells += (base ? t.sells : t.buys) || 0;
      dexTotals[w].volume += p.volume?.[w] || 0;
    }
  }
  const totalLiquidity = pairs.reduce((s, p) => s + (p.liquidity?.usd || 0), 0);

  const warnings = [];
  const noGt = () => Promise.reject(new Error('Chain chưa được GeckoTerminal hỗ trợ'));
  const [secR, tradesR, ohlcvR] = await Promise.allSettled([
    chain.gp ? fetchSecurity(chain, canonicalAddr) : Promise.reject(new Error('Chain chưa hỗ trợ kiểm tra bảo mật')),
    chain.gt ? gtJSON(`/networks/${chain.gt}/pools/${mainPair.pairAddress}/trades`, 30_000) : noGt(),
    chain.gt ? fetchOhlcv(chain.gt, mainPair.pairAddress, canonicalAddr, '1h') : noGt(),
  ]);
  const parseTrades = (r) => (r.status === 'fulfilled' ? (r.value.data || []).map((t) => parseTrade(t, canonicalAddr, sol)).filter(Boolean) : []);
  const allTrades = parseTrades(tradesR);

  // Ngưỡng "cá voi": người dùng chọn, hoặc tự động = top 5% lệnh lớn nhất gần đây
  const whaleUsd = Number(opts.whaleUsd) > 0
    ? Number(opts.whaleUsd)
    : autoWhaleThreshold(allTrades.map((t) => t.usd), mainPair.liquidity?.usd || totalLiquidity);
  const [whaleR] = await Promise.allSettled([
    chain.gt ? gtJSON(`/networks/${chain.gt}/pools/${mainPair.pairAddress}/trades?trade_volume_in_usd_greater_than=${whaleUsd}`, 30_000) : noGt(),
  ]);
  if (secR.status === 'rejected') warnings.push('Không lấy được dữ liệu bảo mật/holder: ' + secR.reason.message);
  if (tradesR.status === 'rejected') warnings.push('Không lấy được lịch sử giao dịch: ' + tradesR.reason.message);
  if (ohlcvR.status === 'rejected') warnings.push('Không lấy được biểu đồ giá: ' + ohlcvR.reason.message);

  if (whaleR.status === 'rejected') warnings.push('Không lấy được giao dịch cá voi: ' + whaleR.reason.message);
  const whaleTradesRaw = parseTrades(whaleR);
  const merged = new Map();
  for (const t of [...allTrades, ...whaleTradesRaw]) merged.set(t.id, t);
  const trades = [...merged.values()].sort((a, b) => b.ts - a.ts);

  const sec = secR.status === 'fulfilled' ? secR.value : null;
  const now = Date.now();
  const pairAddrs = new Set(pairs.map((p) => lc(p.pairAddress)));
  if (sec?.raw?.dex) for (const d of sec.raw.dex) { if (d.pair) pairAddrs.add(lc(d.pair)); if (d.id) pairAddrs.add(lc(d.id)); }

  const holders = buildHolders(sec, pairAddrs, sol, canonicalAddr);
  const flow = buildFlow(allTrades, whaleTradesRaw, whaleR.status === 'fulfilled', whaleUsd, dexTotals, now);
  const wallets = buildWallets(trades, whaleUsd, holders, now);
  const security = sec ? buildSecurity(sec.raw, sol) : [];
  const created = pairs.map((p) => p.pairCreatedAt).filter(Boolean);
  const firstPoolAt = created.length ? Math.min(...created) : null;
  const ageDays = firstPoolAt ? (now - firstPoolAt) / 86_400_000 : null;

  const report = {
    generatedAt: new Date(now).toISOString(),
    token: {
      address: canonicalAddr,
      name: tokenMeta.name,
      symbol: tokenMeta.symbol,
      image: ref.info?.imageUrl || null,
      websites: ref.info?.websites || [],
      socials: ref.info?.socials || [],
      totalSupply: num(sec?.raw?.total_supply),
      holderCount: num(sec?.raw?.holder_count),
    },
    chain: { id: chainId, name: chain.name, explorer: chain.explorer, solana: sol },
    otherChains: Object.keys(liqByChain).filter((c) => c !== chainId),
    market: {
      priceUsd: num(mainPair.priceUsd),
      priceChange: mainPair.priceChange || {},
      liquidityUsd: totalLiquidity,
      mainPairLiquidityUsd: mainPair.liquidity?.usd || 0,
      fdv: mainPair.fdv ?? null,
      marketCap: mainPair.marketCap ?? null,
      pairCreatedAt: firstPoolAt,
      ageDays,
      dexTotals,
    },
    pairs: pairs.slice(0, 15).map((p) => ({
      address: p.pairAddress,
      dex: p.dexId,
      label: `${p.baseToken.symbol}/${p.quoteToken.symbol}`,
      liquidityUsd: p.liquidity?.usd || 0,
      volume24h: p.volume?.h24 || 0,
      url: p.url,
      tokenIsBase: tokenIsBase(p),
    })),
    mainPair: { address: mainPair.pairAddress, dex: mainPair.dexId, label: `${mainPair.baseToken.symbol}/${mainPair.quoteToken.symbol}`, url: mainPair.url, gtNetwork: chain.gt },
    whaleUsd,
    holders,
    flow,
    wallets,
    whaleTrades: trades.filter((t) => t.usd >= whaleUsd).slice(0, 40),
    recentTrades: allTrades.slice(0, 40),
    ohlcv: ohlcvR.status === 'fulfilled' ? ohlcvR.value : [],
    security,
    warnings,
  };
  report.analysis = buildAnalysis(report);
  return report;
}

// Tìm token theo mã/tên → danh sách ứng viên (gộp các pool theo token)
async function searchTokens(q) {
  const j = await getJSON(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, 60_000);
  const Q = q.toUpperCase().replace(/^$/, '');
  const map = new Map();
  for (const p of j.pairs || []) {
    // token khớp có thể nằm ở base hoặc quote của pool
    for (const [tok, base] of [[p.baseToken, true], [p.quoteToken, false]]) {
      const sym = (tok.symbol || '').toUpperCase(), name = (tok.name || '').toUpperCase();
      if (!sym.includes(Q) && !name.includes(Q)) continue;
      const key = p.chainId + ':' + lc(tok.address);
      let t = map.get(key);
      if (!t) {
        t = { address: tok.address, symbol: tok.symbol, name: tok.name, chainId: p.chainId, chain: CHAINS[p.chainId]?.name || p.chainId,
          image: null, liquidityUsd: 0, volume24h: 0, marketCap: null, priceUsd: null, priceChange24h: null, pools: 0, hasInfo: false, exact: sym === Q };
        map.set(key, t);
      }
      t.pools++;
      t.liquidityUsd += p.liquidity?.usd || 0;
      t.volume24h += p.volume?.h24 || 0;
      if (base) {
        if (p.info?.imageUrl) t.image = p.info.imageUrl;
        if (p.info) t.hasInfo = true;
        if (t.marketCap == null) t.marketCap = p.marketCap ?? p.fdv ?? null;
        if (t.priceUsd == null) { t.priceUsd = num(p.priceUsd); t.priceChange24h = p.priceChange?.h24 ?? null; }
      }
    }
  }
  // Ưu tiên: khớp chính xác mã → có thông tin (logo/social) → volume 24h (khó làm giả hơn thanh khoản)
  return [...map.values()]
    .sort((a, b) => b.exact - a.exact || b.hasInfo - a.hasInfo || b.volume24h - a.volume24h || b.liquidityUsd - a.liquidityUsd)
    .slice(0, 15);
}

function autoWhaleThreshold(sizes, liq) {
  // Phân vị 95% kích thước lệnh gần đây, làm tròn đẹp, kẹp trong [500, 50 000] USD
  let raw;
  if (sizes.length >= 20) {
    const sorted = [...sizes].sort((a, b) => a - b);
    raw = sorted[Math.floor(sorted.length * 0.95)];
  } else raw = liq * 0.002;
  const clamped = Math.min(50_000, Math.max(500, raw));
  const mag = Math.pow(10, Math.floor(Math.log10(clamped)));
  return Math.round(clamped / mag) * mag;
}

async function fetchSecurity(chain, addr) {
  const url = chain.solana
    ? `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${addr}`
    : `https://api.gopluslabs.io/api/v1/token_security/${chain.gp}?contract_addresses=${addr}`;
  const j = await getJSON(url, 120_000);
  const result = j.result || {};
  const raw = result[addr] || result[lc(addr)] || Object.values(result)[0];
  if (!raw) throw new Error(j.message || 'GoPlus không có dữ liệu cho token này');
  return { raw };
}

async function fetchOhlcv(gtNet, pool, token, tf) {
  const map = {
    '15m': ['minute', 15, 192],
    '1h': ['hour', 1, 168],
    '4h': ['hour', 4, 180],
    '1d': ['day', 1, 180],
  };
  const [unit, agg, limit] = map[tf] || map['1h'];
  const j = await gtJSON(`/networks/${gtNet}/pools/${pool}/ohlcv/${unit}?aggregate=${agg}&limit=${limit}&token=${token}`, 60_000);
  return (j.data?.attributes?.ohlcv_list || [])
    .map(([t, o, h, l, c, v]) => ({ t: t * 1000, o, h, l, c, v }))
    .sort((a, b) => a.t - b.t);
}

function parseTrade(t, token, sol) {
  const a = t.attributes;
  if (!a) return null;
  // Tự xác định mua/bán theo chiều token (không phụ thuộc token là base hay quote của pool)
  let kind;
  if (sameAddr(a.to_token_address, token, sol)) kind = 'buy';
  else if (sameAddr(a.from_token_address, token, sol)) kind = 'sell';
  else return null;
  return {
    id: t.id,
    ts: Date.parse(a.block_timestamp),
    kind,
    usd: Number(a.volume_in_usd) || 0,
    wallet: a.tx_from_address,
    tx: a.tx_hash,
    amount: Number(kind === 'buy' ? a.to_token_amount : a.from_token_amount) || 0,
    price: Number(kind === 'buy' ? a.price_to_in_usd : a.price_from_in_usd) || 0,
  };
}

function buildHolders(sec, pairAddrs, sol, token) {
  if (!sec?.raw?.holders) return null;
  const raw = sec.raw;
  const list = raw.holders.map((h) => {
    const addr = h.address || h.account;
    const pct = Number(h.percent) * 100;
    let type = 'wallet';
    const tag = h.tag || '';
    if (BURN_ADDRS.has(lc(addr)) || BURN_ADDRS.has(addr)) type = 'burn';
    else if (pairAddrs.has(lc(addr)) || /pool|pair|lp|amm|raydium|pump/i.test(tag)) type = 'lp';
    else if (/binance|okx|bybit|coinbase|kraken|gate|mexc|kucoin|bitget|htx|huobi|exchange|cex/i.test(tag)) type = 'cex';
    else if (Number(h.is_locked) === 1) type = 'locked';
    else if (Number(h.is_contract) === 1) type = 'contract';
    return { address: addr, pct, tag, type, isContract: Number(h.is_contract) === 1, isLocked: Number(h.is_locked) === 1 };
  });
  const sum = (arr) => arr.reduce((s, h) => s + h.pct, 0);
  const real = list.filter((h) => h.type === 'wallet' || h.type === 'contract');
  let lpLockedPct = null;
  if (Array.isArray(raw.lp_holders) && raw.lp_holders.length) {
    lpLockedPct = raw.lp_holders
      // LP nằm trong chính contract token (đã renounce) cũng coi như bị khoá
      .filter((h) => Number(h.is_locked) === 1 || BURN_ADDRS.has(lc(h.address)) || sameAddr(h.address, token, sol))
      .reduce((s, h) => s + Number(h.percent) * 100, 0);
  }
  return {
    count: num(raw.holder_count),
    top: list,
    top10Pct: sum(list.slice(0, 10)),
    top10RealPct: sum(real.slice(0, 10)),
    biggestRealPct: real[0]?.pct || 0,
    creatorPct: raw.creator_percent != null ? Number(raw.creator_percent) * 100 : null,
    ownerPct: raw.owner_percent != null ? Number(raw.owner_percent) * 100 : null,
    creatorAddress: raw.creator_address || null,
    lpLockedPct,
  };
}

const WINDOWS = [
  { key: 'm5', label: '5 phút', ms: 5 * 60_000 },
  { key: 'h1', label: '1 giờ', ms: 3_600_000 },
  { key: 'h6', label: '6 giờ', ms: 6 * 3_600_000 },
  { key: 'h24', label: '24 giờ', ms: 24 * 3_600_000 },
];

function buildFlow(allTrades, whaleTrades, whaleOk, whaleUsd, dexTotals, now) {
  // Mẫu "allTrades" là 300 lệnh gần nhất → chỉ phủ được một khoảng thời gian nhất định
  const full = allTrades.length < 300;
  const coverMs = allTrades.length ? now - Math.min(...allTrades.map((t) => t.ts)) : 0;
  const whaleFull = whaleTrades.length < 300;
  const whaleCoverMs = whaleTrades.length ? now - Math.min(...whaleTrades.map((t) => t.ts)) : 0;

  const windows = WINDOWS.map((w) => {
    const since = now - w.ms;
    const sample = allTrades.filter((t) => t.ts >= since);
    const exact = full || coverMs >= w.ms;
    const agg = (arr, kind) => arr.filter((t) => t.kind === kind).reduce((s, t) => s + t.usd, 0);
    let buyUsd = agg(sample, 'buy');
    let sellUsd = agg(sample, 'sell');
    const dexVol = dexTotals[w.key].volume;
    let estimated = false;
    if (!exact && buyUsd + sellUsd > 0 && dexVol > 0) {
      // Ngoại suy: tỷ lệ mua/bán theo mẫu × volume thật của DexScreener
      const r = buyUsd / (buyUsd + sellUsd);
      buyUsd = dexVol * r;
      sellUsd = dexVol * (1 - r);
      estimated = true;
    }
    const wh = whaleTrades.filter((t) => t.ts >= since);
    const whaleBuyUsd = agg(wh, 'buy');
    const whaleSellUsd = agg(wh, 'sell');
    const whaleExact = whaleFull || whaleCoverMs >= w.ms;
    return {
      key: w.key,
      label: w.label,
      buys: dexTotals[w.key].buys,
      sells: dexTotals[w.key].sells,
      volume: dexVol,
      buyUsd,
      sellUsd,
      netUsd: buyUsd - sellUsd,
      estimated,
      uniqueBuyers: exact ? new Set(sample.filter((t) => t.kind === 'buy').map((t) => t.wallet)).size : null,
      uniqueSellers: exact ? new Set(sample.filter((t) => t.kind === 'sell').map((t) => t.wallet)).size : null,
      whaleBuyUsd,
      whaleSellUsd,
      whaleBuyCount: wh.filter((t) => t.kind === 'buy').length,
      whaleSellCount: wh.filter((t) => t.kind === 'sell').length,
      whaleWallets: new Set(wh.map((t) => t.wallet)).size,
      whaleOk,
      whaleBuyShare: !whaleOk ? null : buyUsd > 0 ? Math.min(100, (whaleBuyUsd / buyUsd) * 100) : null,
      whaleSellShare: !whaleOk ? null : sellUsd > 0 ? Math.min(100, (whaleSellUsd / sellUsd) * 100) : null,
      whaleExact,
    };
  });

  // Chuỗi thời gian mua/bán (USD) theo bucket, chỉ trong khoảng mẫu phủ được
  const span = Math.min(24 * 3_600_000, coverMs || 3_600_000);
  const bucketMs = span <= 2 * 3_600_000 ? 5 * 60_000 : span <= 8 * 3_600_000 ? 15 * 60_000 : 3_600_000;
  const start = Math.floor((now - span) / bucketMs) * bucketMs;
  const buckets = [];
  for (let t = start; t <= now; t += bucketMs) buckets.push({ t, buyUsd: 0, sellUsd: 0, whaleBuyUsd: 0, whaleSellUsd: 0, buys: 0, sells: 0 });
  for (const tr of allTrades) {
    const i = Math.floor((tr.ts - start) / bucketMs);
    if (i < 0 || i >= buckets.length) continue;
    const b = buckets[i];
    if (tr.kind === 'buy') { b.buyUsd += tr.usd; b.buys++; } else { b.sellUsd += tr.usd; b.sells++; }
  }
  for (const tr of whaleTrades) {
    const i = Math.floor((tr.ts - start) / bucketMs);
    if (i < 0 || i >= buckets.length) continue;
    if (tr.kind === 'buy') buckets[i].whaleBuyUsd += tr.usd; else buckets[i].whaleSellUsd += tr.usd;
  }

  return {
    windows,
    sampleSize: allTrades.length,
    sampleCoverMs: coverMs,
    sampleComplete: full,
    whaleSampleSize: whaleTrades.length,
    whaleCoverMs,
    whaleComplete: whaleFull,
    bucketMs,
    series: buckets,
  };
}

function buildWallets(trades, whaleUsd, holders, now) {
  const holderMap = new Map((holders?.top || []).map((h, i) => [lc(h.address), { rank: i + 1, pct: h.pct }]));
  const m = new Map();
  for (const t of trades) {
    if (now - t.ts > 24 * 3_600_000) continue;
    let w = m.get(t.wallet);
    if (!w) {
      w = { wallet: t.wallet, buyUsd: 0, sellUsd: 0, buys: 0, sells: 0, maxTrade: 0, last: 0 };
      m.set(t.wallet, w);
    }
    if (t.kind === 'buy') { w.buyUsd += t.usd; w.buys++; } else { w.sellUsd += t.usd; w.sells++; }
    w.maxTrade = Math.max(w.maxTrade, t.usd);
    w.last = Math.max(w.last, t.ts);
  }
  return [...m.values()]
    .map((w) => ({ ...w, netUsd: w.buyUsd - w.sellUsd, isWhale: w.maxTrade >= whaleUsd, holder: holderMap.get(lc(w.wallet)) || null }))
    .sort((a, b) => b.buyUsd + b.sellUsd - (a.buyUsd + a.sellUsd))
    .slice(0, 25);
}

function buildSecurity(r, sol) {
  const out = [];
  const add = (label, status, detail = '') => out.push({ label, status, detail });
  const flag = (v) => (v === undefined || v === null || v === '' ? null : String(v) === '1');

  if (sol) {
    const st = (o) => (o && o.status !== undefined ? String(o.status) === '1' : null);
    const chk = (label, v, badText, goodText, sev = 'bad') => {
      if (v === null) return add(label, 'na', 'Không có dữ liệu');
      add(label, v ? sev : 'good', v ? badText : goodText);
    };
    chk('Quyền mint thêm token', st(r.mintable), 'Còn quyền mint — có thể in thêm token', 'Đã khoá quyền mint');
    chk('Quyền đóng băng (freeze)', st(r.freezable), 'Dev có thể đóng băng ví người dùng', 'Không có quyền freeze');
    chk('Quyền sửa số dư', st(r.balance_mutable_authority), 'Có quyền sửa số dư ví', 'Không có');
    chk('Quyền đóng token account', st(r.closable), 'Có thể đóng token', 'Không có');
    chk('Metadata có thể sửa', st(r.metadata_mutable), 'Dev có thể đổi tên/logo', 'Metadata cố định', 'warn');
    const fee = r.transfer_fee && Object.keys(r.transfer_fee).length ? r.transfer_fee : null;
    if (fee) add('Phí chuyển (Token-2022)', 'warn', `Có phí chuyển: ${JSON.stringify(fee)}`);
    else add('Phí chuyển (Token-2022)', 'good', 'Không có phí chuyển');
    chk('Transfer hook', Array.isArray(r.transfer_hook) ? r.transfer_hook.length > 0 : null, 'Có transfer hook — có thể chặn bán', 'Không có');
    chk('Không thể chuyển nhượng', flag(r.non_transferable), 'Token không thể chuyển', 'Bình thường');
    if (r.default_account_state !== undefined)
      add('Trạng thái ví mặc định', String(r.default_account_state) === '2' ? 'bad' : 'good', String(r.default_account_state) === '2' ? 'Ví mới bị đóng băng mặc định' : 'Bình thường');
    if (r.trusted_token !== undefined) add('Token uy tín (GoPlus)', Number(r.trusted_token) === 1 ? 'good' : 'na', Number(r.trusted_token) === 1 ? 'Nằm trong danh sách tin cậy' : 'Không thuộc danh sách tin cậy');
    return out;
  }

  const chk = (label, key, badText, goodText, sev = 'bad') => {
    const v = flag(r[key]);
    if (v === null) return add(label, 'na', 'Không có dữ liệu');
    add(label, v ? sev : 'good', v ? badText : goodText);
  };
  chk('Honeypot (không bán được)', 'is_honeypot', 'PHÁT HIỆN HONEYPOT — không bán được!', 'Bán được bình thường');
  const bt = num(r.buy_tax), st = num(r.sell_tax);
  const taxStatus = (t) => (t === null ? 'na' : t > 0.1 ? 'bad' : t > 0 ? 'warn' : 'good');
  add('Thuế mua', taxStatus(bt), bt === null ? 'Không rõ' : `${(bt * 100).toFixed(1)}%`);
  add('Thuế bán', taxStatus(st), st === null ? 'Không rõ' : `${(st * 100).toFixed(1)}%`);
  chk('Không bán được toàn bộ', 'cannot_sell_all', 'Không cho bán hết số dư', 'Bán hết được');
  const os = flag(r.is_open_source);
  add('Mã nguồn công khai', os === null ? 'na' : os ? 'good' : 'bad', os === null ? 'Không rõ' : os ? 'Đã verify' : 'Không verify mã nguồn — rủi ro cao');
  const owner = lc(r.owner_address);
  if (r.owner_address !== undefined)
    add('Quyền owner', !owner || BURN_ADDRS.has(owner) ? 'good' : 'warn', !owner || BURN_ADDRS.has(owner) ? 'Đã renounce' : `Owner: ${r.owner_address}`);
  chk('Mint thêm token', 'is_mintable', 'Có thể in thêm token', 'Không mint được');
  chk('Proxy (nâng cấp được)', 'is_proxy', 'Contract có thể bị thay logic', 'Không phải proxy', 'warn');
  chk('Owner ẩn', 'hidden_owner', 'Có owner ẩn', 'Không');
  chk('Lấy lại quyền owner', 'can_take_back_ownership', 'Có thể lấy lại quyền sau renounce', 'Không');
  chk('Blacklist', 'is_blacklisted', 'Có chức năng blacklist ví', 'Không', 'warn');
  chk('Tạm dừng giao dịch', 'transfer_pausable', 'Có thể pause giao dịch', 'Không', 'warn');
  chk('Đổi thuế/slippage', 'slippage_modifiable', 'Owner có thể đổi thuế', 'Thuế cố định');
  chk('Đổi thuế từng ví', 'personal_slippage_modifiable', 'Có thể đặt thuế riêng từng ví', 'Không');
  chk('Cooldown giao dịch', 'trading_cooldown', 'Có giới hạn thời gian giữa các lệnh', 'Không', 'warn');
  chk('Gọi contract ngoài', 'external_call', 'Có external call', 'Không', 'warn');
  chk('Tự huỷ contract', 'selfdestruct', 'Có selfdestruct', 'Không');
  chk('Creator từng tạo honeypot', 'honeypot_with_same_creator', 'Creator từng deploy honeypot!', 'Không');
  if (r.is_in_cex) add('Niêm yết CEX', r.is_in_cex.listed === '1' ? 'good' : 'na', r.is_in_cex.listed === '1' ? (r.is_in_cex.cex_list || []).join(', ') : 'Chưa niêm yết');
  return out;
}

// ---------- phân tích & nhận định ----------
function buildAnalysis(rep) {
  const pos = [], neg = [], neutral = [];
  let risk = 0;
  const m = rep.market;
  const fmt = (n) => '$' + compact(n);

  // Bảo mật
  const bad = rep.security.filter((s) => s.status === 'bad');
  const warn = rep.security.filter((s) => s.status === 'warn');
  if (bad.some((s) => /Honeypot/.test(s.label))) { risk += 60; neg.push('Phát hiện HONEYPOT — gần như chắc chắn không bán được.'); }
  for (const s of bad.filter((s) => !/Honeypot/.test(s.label))) { risk += 12; neg.push(`${s.label}: ${s.detail}`); }
  risk += Math.min(15, warn.length * 3);
  if (!rep.security.length) { risk += 10; neutral.push('Không có dữ liệu bảo mật contract — tự kiểm tra thêm.'); }
  else if (!bad.length) pos.push('Không phát hiện cờ bảo mật nghiêm trọng trong contract.');

  // Thanh khoản
  const liq = m.liquidityUsd;
  if (liq < 10_000) { risk += 20; neg.push(`Thanh khoản rất thấp (${fmt(liq)}) — trượt giá lớn, dễ bị rút.`); }
  else if (liq < 50_000) { risk += 10; neg.push(`Thanh khoản thấp (${fmt(liq)}).`); }
  else if (liq > 1_000_000) pos.push(`Thanh khoản tốt (${fmt(liq)}).`);
  if (rep.holders?.lpLockedPct != null) {
    if (rep.holders.lpLockedPct >= 90) pos.push(`${rep.holders.lpLockedPct.toFixed(0)}% LP đã khoá/burn.`);
    else if (rep.holders.lpLockedPct < 50) { risk += 10; neg.push(`Chỉ ${rep.holders.lpLockedPct.toFixed(0)}% LP được khoá/burn — nguy cơ rút thanh khoản.`); }
  }

  // Tuổi
  if (m.ageDays != null) {
    if (m.ageDays < 1) { risk += 15; neg.push(`Pool mới tạo ${(m.ageDays * 24).toFixed(1)} giờ trước — rất rủi ro.`); }
    else if (m.ageDays < 7) { risk += 8; neutral.push(`Token còn mới (${m.ageDays.toFixed(1)} ngày).`); }
    else if (m.ageDays > 180) pos.push(`Đã hoạt động ${Math.floor(m.ageDays)} ngày.`);
  }

  // Phân bổ holder
  const h = rep.holders;
  if (h) {
    if (h.top10RealPct > 50) { risk += 20; neg.push(`Top 10 ví (không tính LP/burn/CEX) nắm ${h.top10RealPct.toFixed(1)}% — tập trung rất cao.`); }
    else if (h.top10RealPct > 30) { risk += 10; neutral.push(`Top 10 ví nắm ${h.top10RealPct.toFixed(1)}% — tập trung khá cao.`); }
    else pos.push(`Phân bổ khá đều: top 10 ví nắm ${h.top10RealPct.toFixed(1)}%.`);
    if (h.biggestRealPct > 10) { risk += 8; neg.push(`Ví lớn nhất nắm ${h.biggestRealPct.toFixed(1)}% nguồn cung.`); }
    if (h.creatorPct > 5) { risk += 8; neg.push(`Ví creator còn giữ ${h.creatorPct.toFixed(1)}%.`); }
    if (h.count != null && h.count < 200) { risk += 8; neg.push(`Chỉ có ${h.count} holder.`); }
  }

  // Áp lực mua bán
  const w24 = rep.flow.windows.find((w) => w.key === 'h24');
  const w1 = rep.flow.windows.find((w) => w.key === 'h1');
  let pressure = 'cân bằng';
  if (w24) {
    const ratio = w24.sells ? w24.buys / w24.sells : w24.buys ? 9 : 1;
    const usdRatio = w24.sellUsd ? w24.buyUsd / w24.sellUsd : null;
    if (usdRatio != null && usdRatio > 1.25) { pressure = 'mua mạnh'; pos.push(`24h: giá trị mua gấp ${usdRatio.toFixed(2)}× giá trị bán.`); }
    else if (usdRatio != null && usdRatio < 0.8) { pressure = 'bán mạnh'; neg.push(`24h: giá trị bán gấp ${(1 / usdRatio).toFixed(2)}× giá trị mua.`); }
    neutral.push(`24h: ${w24.buys.toLocaleString('vi')} lệnh mua / ${w24.sells.toLocaleString('vi')} lệnh bán (tỷ lệ ${ratio.toFixed(2)}).`);
    if (liq > 0) {
      const turnover = w24.volume / liq;
      if (turnover > 5) neutral.push(`Volume 24h gấp ${turnover.toFixed(1)}× thanh khoản — giao dịch rất sôi động (có thể có wash trading).`);
      else if (turnover < 0.05) neutral.push('Volume rất thấp so với thanh khoản — ít người quan tâm.');
    }
  }
  if (w1 && w1.volume > 0) {
    const r = w1.sells ? w1.buys / w1.sells : 9;
    if (r > 1.5) neutral.push(`1 giờ gần nhất: số lệnh mua áp đảo (${w1.buys} mua / ${w1.sells} bán).`);
    else if (r < 0.67) neutral.push(`1 giờ gần nhất: số lệnh bán áp đảo (${w1.buys} mua / ${w1.sells} bán).`);
  }

  // Cá voi
  const ww = rep.flow.windows.find((w) => w.key === 'h24') || {};
  const whaleNet = (ww.whaleBuyUsd || 0) - (ww.whaleSellUsd || 0);
  let whaleView = ww.whaleOk ? 'không có giao dịch lớn' : 'chưa có dữ liệu cá voi';
  if (ww.whaleBuyUsd + ww.whaleSellUsd > 0) {
    if (whaleNet > 0.2 * (ww.whaleBuyUsd + ww.whaleSellUsd)) { whaleView = 'cá voi đang gom'; pos.push(`Cá voi (lệnh ≥ ${fmt(rep.whaleUsd)}) mua ròng ${fmt(whaleNet)} trong 24h.`); }
    else if (whaleNet < -0.2 * (ww.whaleBuyUsd + ww.whaleSellUsd)) { whaleView = 'cá voi đang xả'; risk += 8; neg.push(`Cá voi (lệnh ≥ ${fmt(rep.whaleUsd)}) bán ròng ${fmt(-whaleNet)} trong 24h.`); }
    else whaleView = 'cá voi mua bán cân bằng';
    if (ww.whaleBuyShare != null) neutral.push(`Ví lớn chiếm ~${ww.whaleBuyShare.toFixed(0)}% giá trị mua và ~${(ww.whaleSellShare || 0).toFixed(0)}% giá trị bán trong 24h.`);
  }
  const sellingHolders = rep.wallets.filter((w) => w.holder && w.sellUsd > w.buyUsd);
  if (sellingHolders.length) { risk += 5; neg.push(`${sellingHolders.length} ví trong top holder đang bán ra gần đây.`); }

  // Giá
  const pc = m.priceChange || {};
  if (pc.h24 != null) {
    if (pc.h24 < -30) { risk += 5; neg.push(`Giá giảm mạnh ${pc.h24}% trong 24h.`); }
    else if (pc.h24 > 50) neutral.push(`Giá tăng nóng ${pc.h24}% trong 24h — cẩn thận FOMO.`);
  }

  risk = Math.max(0, Math.min(100, Math.round(risk)));
  const level = risk >= 70 ? 'critical' : risk >= 45 ? 'serious' : risk >= 25 ? 'warning' : 'good';
  const levelText = { critical: 'Rủi ro rất cao', serious: 'Rủi ro cao', warning: 'Rủi ro trung bình', good: 'Rủi ro thấp' }[level];
  const summary = `${rep.token.symbol} trên ${rep.chain.name}: ${levelText.toLowerCase()} (${risk}/100). Áp lực 24h: ${pressure}; ${whaleView}.`;
  return { risk, level, levelText, summary, pressure, whaleView, positives: pos, negatives: neg, notes: neutral };
}

function compact(n) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}


window.WS = { analyze, searchTokens, fetchOhlcv };
})();
