(() => {
  const { root, fetchJSON, loadNews, renderSkeleton, renderError, escHtml, formatDate, formatEAT, formatCompact, formatNumber, percent, tone, articleUrl, issuerUrl, updateFooter, ISSUERS } = FC;
  const REFRESH_MS = 60000;
  const view = {
    payload: null, loading: true, error: null, refreshedAt: null, stockQuery: '', stockSort: 'turnover',
    stockSector: 'all', moverTab: 'gainers', macroRange: '3Y', historyIndex: 'NASI', fxQuery: '',
    fxFrom: 'USD', fxTo: 'KES', articles: [], refreshing: false,
  };
  const charts = [];
  const num = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  
  // Skeleton templates for instant visual feedback
  function renderMetricSkeleton() {
    return `<div class="market-card metric-card p-5"><div class="h-4 w-1/3 bg-zinc-200 dark:bg-zinc-700 animate-pulse rounded mb-2"></div><div class="h-8 w-1/2 bg-zinc-200 dark:bg-zinc-700 animate-pulse rounded"></div><div class="h-3 w-3/4 bg-zinc-200 dark:bg-zinc-700 animate-pulse rounded mt-2"></div></div>`;
  }
  function renderCardSkeleton(title = 'Section') {
    return `<div class="market-card p-5 sm:p-6"><div class="h-4 w-1/4 bg-zinc-200 dark:bg-zinc-700 animate-pulse rounded mb-2"></div><div class="h-6 w-1/3 bg-zinc-200 dark:bg-zinc-700 animate-pulse rounded mb-5"></div><div class="h-3 w-full bg-zinc-200 dark:bg-zinc-700 animate-pulse rounded"></div><div class="h-3 w-2/3 bg-zinc-200 dark:bg-zinc-700 animate-pulse rounded mt-2"></div></div>`;
  }
  function renderTableSkeleton(cols = 5, rows = 6) {
    const header = cols.map(() => '<th><div class="h-4 w-1/2 bg-zinc-200 dark:bg-zinc-700 animate-pulse rounded"></div></th>').join('');
    const row = cols.map(() => '<td><div class="h-4 w-3/4 bg-zinc-200 dark:bg-zinc-700 animate-pulse rounded"></div></td>').join('');
    const rowsHtml = Array(rows).fill(`<tr>${row}</tr>`).join('');
    return `<div class="market-card overflow-hidden"><div class="p-4 border-b border-[#E5E7EB] dark:border-zinc-800"><div class="h-4 w-1/4 bg-zinc-200 dark:bg-zinc-700 animate-pulse rounded"></div></div><div class="market-scroll max-h-[620px] overflow-y-auto"><table class="data-table"><thead><tr>${header}</tr></thead><tbody>${rowsHtml}</tbody></table></div></div>`;
  }
  
  function changePercent(quote, index = false) {
    const explicit = num(quote.changePct);
    if (explicit !== null) return explicit;
    const price = num(index ? quote.value : quote.price);
    const previous = num(quote.previousClose);
    if (price !== null && previous !== null && previous !== 0) return (price - previous) / previous * 100;
    const absolute = num(quote.changeAbs ?? quote.change);
    if (price !== null && absolute !== null && price - absolute !== 0) return absolute / (price - absolute) * 100;
    return null;
  }
  const quoteChange = (stock) => {
    const percentage = changePercent(stock);
    if (percentage !== null) return percent(percentage);
    const absolute = num(stock.changeAbs ?? stock.change);
    return absolute !== null ? `${formatNumber(absolute,2)} KES` : '—';
  };
  const nseData = () => view.payload?.nse || {};
  const fixedData = () => view.payload?.fixedIncome || {};
  const cbrData = () => fixedData().centralBankRate || fixedData().cbr || fixedData().policyRate || {};
  const inflationData = () => fixedData().inflation || {};
  const bills = () => fixedData().treasuryBills || fixedData().treasury?.bills || fixedData().bills || [];
  const forexData = () => view.payload?.forex || {};
  function lastSuccessfulFetch(payload) {
    const sections = [payload?.nse, payload?.forex, payload?.fixedIncome?.treasuryBillsMeta, payload?.fixedIncome?.centralBankRate, payload?.fixedIncome?.inflation];
    const times = sections.map((section) => Date.parse(section?.fetchedAt || '')).filter(Number.isFinite);
    return times.length ? Math.min(...times) : null;
  }
  const stocks = () => {
    const nse = nseData();
    if (Array.isArray(nse.stocks) && nse.stocks.length) return nse.stocks;
    if (Array.isArray(nse.movers?.stocks)) return nse.movers.stocks;
    return [...(nse.movers?.gainers || []), ...(nse.movers?.losers || [])];
  };
  function dataStatus(section) {
    if (section?.available) return section.stale ? 'Cached · stale' : section.status === 'daily_reference' ? 'Official daily' : 'Provider connected';
    if (section?.providerConfigured) return 'Provider error';
    return 'Not configured';
  }
  function sourceLine(section, dateLabel = 'as of') {
    if (!section) return 'Source unavailable';
    const schedule = section.status === 'on_offer' || Array.isArray(section.treasuryBills);
    const rawDate = schedule ? null : dateLabel === 'observation month' ? section.observationDate || section.asOf : section.asOf || section.updatedAt;
    const date = escHtml(formatDate(rawDate, { day: '2-digit', month: 'short', year: 'numeric' }));
    return `${section.stale ? 'Cached/stale · ' : ''}${escHtml(section.source || 'Official source')}${date !== '—' ? ` · ${escHtml(dateLabel)} ${date}` : ''}`;
  }
  function fetchedLine() {
    return view.refreshedAt ? `Fetched ${escHtml(formatEAT(view.refreshedAt))}` : 'Fetch time unavailable';
  }
  function supportedIssuer(ticker) {
    const symbol = String(ticker || '').trim().toUpperCase();
    return ISSUERS.find((issuer) => issuer.ticker.toUpperCase() === symbol);
  }
  function tickerMarkup(stock, classes = 'font-mono font-bold') {
    const ticker = String(stock.ticker || '—');
    const issuer = supportedIssuer(stock.ticker);
    const label = escHtml(ticker);
    return issuer
      ? `<a href="${escHtml(issuerUrl(issuer.ticker))}" class="${classes} hover:text-[#FF4D1C]">${label}</a>`
      : `<span class="${classes}">${label}</span>`;
  }
  function scrollToHash() {
    if (!location.hash) return;
    let id = '';
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
  }
  function renderMetric(label, value, note, color = '') {
    return `<div class="market-card metric-card p-5"><div class="text-[10px] font-mono uppercase tracking-[0.12em] text-zinc-500">${escHtml(label)}</div><div class="font-display font-extrabold text-2xl sm:text-3xl mt-2 tabular ${color}">${value}</div><div class="text-[11px] text-zinc-500 mt-2 leading-relaxed">${note}</div></div>`;
  }
  function unavailableCard(title, text, href = '') {
    return `<div class="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-[#F5F5F7] dark:bg-zinc-900/60 p-6 sm:p-8 text-center"><div class="w-11 h-11 mx-auto rounded-xl bg-[#0B0B0C] dark:bg-zinc-800 text-white flex items-center justify-center"><svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 19V9m5 10V5m5 14v-7m5 7V3"/></svg></div><h3 class="font-display font-bold text-lg mt-4">${escHtml(title)}</h3><p class="text-xs sm:text-sm text-zinc-500 mt-2 max-w-xl mx-auto leading-relaxed">${escHtml(text)}</p>${href ? `<a href="${escHtml(href)}" target="_blank" rel="noopener noreferrer" class="inline-flex mt-4 px-4 py-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs font-bold">Visit official source ↗</a>` : ''}</div>`;
  }
  function renderPageHeader() {
    const nse = nseData();
    const forex = forexData();
    const status = nse.available ? nse.status || 'provider' : nse.providerConfigured ? 'provider error' : 'not configured';
    return `<header class="flex flex-col xl:flex-row xl:items-end justify-between gap-7 mb-10">
      <div class="max-w-3xl">
        <div class="flex flex-wrap items-center gap-2 mb-4">
          <span class="text-[10px] font-mono uppercase tracking-[0.18em] text-[#FF4D1C]">Capital markets dashboard</span>
          <span class="status-pill"><span class="source-dot ${nse.available ? '' : 'warning'}"></span>NSE ${escHtml(status)}</span>
          <span class="status-pill"><span class="source-dot ${forex.available ? '' : 'offline'}"></span>CBK ${forex.available ? 'official daily' : 'unavailable'}</span>
        </div>
        <h1 class="font-display font-extrabold text-4xl sm:text-5xl lg:text-6xl tracking-[-0.04em] leading-[1.02]">Markets, with the context intact.</h1>
        <p class="text-zinc-500 dark:text-zinc-400 text-sm sm:text-base mt-4 max-w-2xl leading-relaxed">NSE equities and index analytics when licensed data is available. Official CBK Forex, Treasury and macro series show observation dates separately from the page fetch time.</p>
      </div>
      <div class="xl:text-right flex flex-col items-end gap-3">
        <div class="text-right">
          <div class="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Nairobi local time</div>
          <div id="market-clock" class="font-mono text-xl mt-1 text-[#111315] dark:text-white">— EAT</div>
        </div>
        <div class="flex items-center gap-3">
          <div class="hidden xl:block text-right text-[11px] text-zinc-500">Last successful fetch ${view.refreshedAt ? escHtml(formatEAT(view.refreshedAt)) : '—'}</div>
          <button id="refresh-markets" onclick="refreshMarkets(true)" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#FF4D1C] hover:bg-[#E03D10] text-white text-xs font-bold shrink-0">
            <svg id="refresh-icon" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v6h6M20 20v-6h-6M20 8A8 8 0 0 0 5.1 6.1M4 16a8 8 0 0 0 14.9 1.9"/></svg>Refresh data
          </button>
        </div>
      </div>
    </header>
    <nav class="flex items-center gap-1 overflow-x-auto mt-6 pt-5 border-t border-[#E5E7EB] dark:border-zinc-800" aria-label="Markets sections">${[['overview','Overview'],['equities','Equities'],['fixed-income','Fixed income'],['forex','Forex'],['macro','Macro'],['news','Catalysts']].map(([id,label]) => `<a href="#${id}" class="px-3.5 py-2 rounded-lg text-xs text-zinc-500 hover:text-[#111315] dark:hover:text-white hover:bg-[#F5F5F7] dark:hover:bg-zinc-800 whitespace-nowrap">${label}</a>`).join('')}</nav>`;
  }
  function renderOverview() {
    const nse = nseData();
    const summary = nse.marketSummary || {};
    const cbr = cbrData();
    const inflation = inflationData();
    const usd = forexData().pairs?.find((pair) => pair.code === 'USD');
    const indices = Array.isArray(nse.indices) ? nse.indices : [];
    const equityStocks = stocks();

    const marketCap = num(summary.totalMarketCap);
    const turnover = num(summary.totalTurnover);

    return `<section id="overview" class="space-y-8 scroll-mt-44">
      <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <span class="text-[10px] font-mono uppercase tracking-wider text-[#FF4D1C]">01 · Market pulse</span>
          <h2 class="font-display font-extrabold text-2xl sm:text-3xl mt-1">The session at a glance</h2>
        </div>
        <span class="hidden sm:block text-[11px] text-zinc-500">Auto-refresh every 60 seconds</span>
      </div>

      <div class="grid grid-cols-2 xl:grid-cols-5 gap-3 sm:gap-4">
        ${renderMetric('NSE market capitalisation', marketCap !== null ? 'KES ' + formatCompact(marketCap) : (nse.available ? '—' : 'Provider not configured'), nse.available ? (marketCap !== null ? 'Provider-reported market value' : 'No market cap data returned') : 'Configure a licensed NSE quote feed')}
        ${renderMetric('NSE equity turnover', turnover !== null ? 'KES ' + formatCompact(turnover) : (nse.available ? '—' : 'Provider not configured'), nse.available ? (turnover !== null ? 'Reported equity turnover' : 'No turnover data returned') : 'No simulated turnover is shown')}
        ${renderMetric('Central bank rate', num(cbr.rate) !== null ? formatNumber(cbr.rate, 2) + '%' : '—', sourceLine(cbr, 'rate date'), 'text-[#FF4D1C]')}
        ${renderMetric('12-month inflation', num(inflation.twelveMonth) !== null ? formatNumber(inflation.twelveMonth, 2) + '%' : '—', inflation.month ? `${escHtml(inflation.month)} ${escHtml(inflation.year)} · ${sourceLine(inflation, 'observation month')}` : sourceLine(inflation, 'observation month'))}
        ${usd ? renderMetric('USD / KES reference', formatNumber(usd.rate, 2), sourceLine(forexData(), 'reference date') + ' · indicative daily rate') : ''}
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-3 gap-5">
        ${indices.length ? indices.slice(0, 6).map((index) => renderIndexCard(index)).join('') : `<div class="xl:col-span-3">${unavailableCard('NSE index feed is not connected', nse.reason || 'Configure a licensed market-data provider on the server to display index levels, breadth, equity prices, volume and turnover. No placeholder prices are presented as live.', 'https://www.nse.co.ke/')}</div>`}
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div class="market-card xl:col-span-2 overflow-hidden">
          <div class="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E5E7EB] dark:border-zinc-800">
            <div>
              <div class="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Performance history</div>
              <h3 class="font-display font-bold text-xl mt-1">${escHtml(view.historyIndex)} index trajectory</h3>
            </div>
            ${indices.length > 1 ? `<select onchange="setHistoryIndex(this.value)" class="px-3 py-2 rounded-lg bg-[#F5F5F7] dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs">${indices.map((index) => `<option value="${escHtml(index.code)}" ${view.historyIndex === index.code ? 'selected' : ''}>${escHtml(index.code)}</option>`).join('')}</select>` : ''}
          </div>
          ${renderIndexHistory()}
        </div>
        <div class="market-card p-5 sm:p-6">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Leaderboard</div>
              <h3 class="font-display font-bold text-xl mt-1">Price movers</h3>
            </div>
            <div class="flex rounded-lg bg-[#F5F5F7] dark:bg-zinc-900 p-0.5 text-[10px]">
              <button onclick="setMoverTab('gainers')" class="px-2.5 py-1.5 rounded-md ${view.moverTab === 'gainers' ? 'bg-white dark:bg-zinc-800 font-bold' : 'text-zinc-500'}">Gainers</button>
              <button onclick="setMoverTab('losers')" class="px-2.5 py-1.5 rounded-md ${view.moverTab === 'losers' ? 'bg-white dark:bg-zinc-800 font-bold' : 'text-zinc-500'}">Losers</button>
            </div>
          </div>
          <div id="mover-list" class="mt-5">${renderMovers()}</div>
          <div class="mt-5 pt-4 border-t border-[#E5E7EB] dark:border-zinc-800 flex items-center justify-between text-xs">
            <span class="text-zinc-500">Market breadth</span>
            <span class="font-mono font-bold">${breadthText()}</span>
          </div>
        </div>
      </div>
    </section>`;
  }
  function renderIndexCard(index) {
    const value = num(index.value);
    const change = changePercent(index, true);
    return `<a href="#overview" onclick="setHistoryIndex('${encodeURIComponent(index.code).replace(/'/g,'%27')}');return false" class="market-card p-5 group hover:border-[#FF4D1C]/50 transition-colors"><div class="flex items-start justify-between gap-3"><div><div class="font-mono text-[10px] uppercase tracking-wider text-zinc-500">${escHtml(index.code)}</div><h3 class="font-display font-bold text-sm mt-1 line-clamp-2">${escHtml(index.name || index.code)}</h3></div><span class="text-zinc-400 group-hover:text-[#FF4D1C]">↗</span></div><div class="font-display font-extrabold text-2xl sm:text-3xl mt-5 tabular">${value !== null ? formatNumber(value,2) : '—'}</div><div class="flex items-center justify-between mt-2 text-xs"><span class="font-bold ${tone(change)}">${percent(change)}</span><span class="text-zinc-500">${num(index.changeAbs) !== null ? formatNumber(index.changeAbs,2) : '—'} pts</span></div></a>`;
  }
  function historyPoints(indexCode) {
    const nse = nseData();
    const history = nse.history || {};
    let raw = history[indexCode] || history[nse.indices?.find((index) => index.code === indexCode)?.name] || (indexCode === 'NASI' ? history.nasi : indexCode === 'NSE20' ? history.nse20 : null);
    if (!raw && indexCode === (nse.indices?.[0]?.code)) raw = history.default || history.points || history.data;
    if (raw && !Array.isArray(raw)) raw = raw.points || raw.data || raw.history || raw.values;
    if (!Array.isArray(raw)) raw = nse.indices?.find((index) => index.code === indexCode)?.history;
    if (!Array.isArray(raw)) return [];
    return raw.map((point) => {
      if (typeof point === 'number') return { date: null, value: point };
      const value = num(point.value ?? point.close ?? point.price ?? point.level);
      const rawDate = point.date || point.time || point.timestamp || point.datetime;
      const parsedDate = rawDate ? new Date(rawDate) : null;
      return { date: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null, value };
    }).filter((point) => point.value !== null);
  }
  function renderIndexHistory() {
    const points = historyPoints(view.historyIndex);
    if (!points.length) return `<div class="p-6">${unavailableCard('Historical index series unavailable', 'No provider history was returned for this index. The chart remains empty rather than synthesising an intraday path.', 'https://www.nse.co.ke/')}</div>`;
    const values = points.map((point) => point.value);
    const change = values.length > 1 ? (values.at(-1) - values[0]) / values[0] * 100 : null;
    return `<div class="p-5 sm:p-6"><div class="flex flex-wrap items-end justify-between gap-3 mb-5"><div><div class="text-[10px] uppercase tracking-wider text-zinc-500">Period return</div><div class="font-display font-extrabold text-3xl mt-1 ${tone(change)}">${percent(change)}</div></div><div class="flex gap-5 text-xs"><span class="text-zinc-500">High <strong class="block text-[#111315] dark:text-white mt-1">${formatNumber(Math.max(...values),2)}</strong></span><span class="text-zinc-500">Low <strong class="block text-[#111315] dark:text-white mt-1">${formatNumber(Math.min(...values),2)}</strong></span><span class="text-zinc-500">Observations <strong class="block text-[#111315] dark:text-white mt-1">${points.length}</strong></span></div></div><div class="chart-box tall"><canvas id="index-history-chart" aria-label="${escHtml(view.historyIndex)} historical index chart" role="img"></canvas></div><div class="text-[10px] text-zinc-500 mt-3">${sourceLine(nseData(), 'provider timestamp')} · ${escHtml(dataStatus(nseData()))}</div></div>`;
  }
  function breadthText() {
    const breadth = nseData().breadth;
    if (!breadth) return '—';
    const advances = num(breadth.advancing ?? breadth.advances ?? breadth.gainers);
    const declines = num(breadth.declining ?? breadth.declines ?? breadth.losers);
    const unchanged = num(breadth.unchanged ?? breadth.flat) || 0;
    return `${advances ?? '—'} ↑ · ${declines ?? '—'} ↓${unchanged ? ` · ${unchanged} =` : ''}`;
  }
  function moverRows() {
    const equityStocks = stocks().filter((stock) => changePercent(stock) !== null);
    const gainers = equityStocks.filter((stock) => changePercent(stock) > 0).sort((a,b) => changePercent(b) - changePercent(a));
    const losers = equityStocks.filter((stock) => changePercent(stock) < 0).sort((a,b) => changePercent(a) - changePercent(b));
    const rows = view.moverTab === 'gainers' ? gainers : losers;
    return rows.slice(0,6);
  }
  function renderMovers() {
    const rows = moverRows();
    if (!rows.length) return `<div class="py-10 text-center text-xs text-zinc-500">${nseData().available ? 'No comparable percentage movers returned.' : 'Connect a licensed NSE quote feed to rank advancing and declining stocks.'}</div>`;
    return `<div class="space-y-2">${rows.map((stock, index) => `<div class="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#F5F5F7] dark:bg-zinc-900"><div class="flex items-center gap-3 min-w-0"><span class="font-mono text-[10px] text-zinc-400">${String(index+1).padStart(2,'0')}</span><div class="min-w-0"><div class="font-mono font-bold text-xs">${tickerMarkup(stock, 'font-mono font-bold text-xs')}</div><div class="text-[10px] text-zinc-500 truncate">${escHtml(stock.name || '')}</div></div></div><div class="text-right shrink-0"><div class="font-mono text-xs font-bold">${formatNumber(stock.price,2)}</div><div class="text-[10px] font-bold ${tone(changePercent(stock))}">${percent(changePercent(stock))}</div></div></div>`).join('')}</div>`;
  }
  function filteredStocks() {
    const term = view.stockQuery.trim().toLowerCase();
    const rows = stocks().filter((stock) => (view.stockSector === 'all' || stock.sector === view.stockSector) && (!term || `${stock.ticker} ${stock.name} ${stock.sector}`.toLowerCase().includes(term)));
    return rows.sort((a,b) => {
      const key = view.stockSort;
      const av = num(key === 'changePct' ? changePercent(a) : a[key]);
      const bv = num(key === 'changePct' ? changePercent(b) : b[key]);
      if (av === null && bv === null) return String(a.ticker).localeCompare(String(b.ticker));
      if (av === null) return 1;
      if (bv === null) return -1;
      return key === 'ticker' || key === 'name' ? String(av).localeCompare(String(bv)) : bv - av;
    });
  }
  function renderEquities() {
    const equityStocks = stocks();
    const sectors = [...new Set(equityStocks.map((stock) => stock.sector).filter(Boolean))].sort();
    return `<section id="equities" class="space-y-5 scroll-mt-44"><div><span class="text-[10px] font-mono uppercase tracking-wider text-[#FF4D1C]">02 · Equity market</span><h2 class="font-display font-extrabold text-2xl sm:text-3xl mt-1">Quotes, activity & sector breadth</h2><p class="text-sm text-zinc-500 mt-2">Price, volume, turnover and valuation fields are displayed only when returned by the licensed provider.</p></div>
      ${equityStocks.length ? `<div class="market-card overflow-hidden"><div class="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-[#E5E7EB] dark:border-zinc-800"><div class="flex flex-col sm:flex-row gap-3 flex-1"><input type="search" value="${escHtml(view.stockQuery)}" oninput="marketStockSearch(this.value)" placeholder="Search ticker, company or sector…" class="w-full sm:max-w-sm px-3.5 py-2.5 rounded-lg bg-[#F5F5F7] dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs"><select onchange="marketStockSector(this.value)" class="px-3.5 py-2.5 rounded-lg bg-[#F5F5F7] dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs"><option value="all">All sectors</option>${sectors.map((sector) => `<option value="${escHtml(sector)}" ${view.stockSector === sector ? 'selected' : ''}>${escHtml(sector)}</option>`).join('')}</select></div><div class="flex items-center justify-between gap-3"><span id="stock-count" class="text-xs text-zinc-500">${filteredStocks().length} stocks</span><button onclick="exportStocks()" class="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold">Export CSV</button></div></div><div class="market-scroll"><table class="data-table"><thead><tr>${[['ticker','Ticker'],['name','Company'],['sector','Sector'],['price','Price'],['changePct','Change'],['previousClose','Prev. close'],['volume','Volume'],['turnover','Turnover'],['marketCap','Market cap']].map(([key,label]) => `<th><button onclick="marketStockSort('${key}')" class="inline-flex items-center gap-1 ${view.stockSort === key ? 'text-[#FF4D1C]' : ''}">${label}${view.stockSort === key ? '↓' : ''}</button></th>`).join('')}</tr></thead><tbody id="stock-rows">${renderStockRows()}</tbody></table></div></div>` : unavailableCard('Licensed equity quotes required', nseData().reason || 'NSE prices, quantities, turnover and market capitalisation are not available without a configured licensed market-data feed.', 'https://www.nse.co.ke/')}
      <div class="market-card p-5 sm:p-6"><div class="flex flex-wrap items-end justify-between gap-3"><div><div class="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Sector map</div><h3 class="font-display font-bold text-xl mt-1">Price performance by sector</h3></div><span class="text-[11px] text-zinc-500">Simple mean of returned stock changes</span></div><div id="sector-grid" class="mt-5">${renderSectors()}</div></div>
    </section>`;
  }
  function renderStockRows() {
    const rows = filteredStocks();
    if (!rows.length) return `<tr><td colspan="9" class="py-10 text-center text-zinc-500">No stocks match this filter.</td></tr>`;
    return rows.map((stock) => `<tr><td>${tickerMarkup(stock)}</td><td class="max-w-[220px] truncate" title="${escHtml(stock.name)}">${escHtml(stock.name || '—')}</td><td class="text-zinc-500">${escHtml(stock.sector || '—')}</td><td class="font-mono font-bold">${formatNumber(stock.price,2)}</td><td class="font-mono font-bold ${tone(changePercent(stock) ?? stock.change)}">${quoteChange(stock)}</td><td class="font-mono text-zinc-500">${formatNumber(stock.previousClose,2)}</td><td class="font-mono">${formatCompact(stock.volume)}</td><td class="font-mono">KES ${formatCompact(stock.turnover)}</td><td class="font-mono">KES ${formatCompact(stock.marketCap)}</td></tr>`).join('');
  }
  function renderSectors() {
    const groups = {};
    stocks().forEach((stock) => {
      const sector = stock.sector || 'Unclassified';
      groups[sector] ||= { changes: [], caps: [], count: 0 };
      groups[sector].count += 1;
      const change = changePercent(stock);
      if (change !== null) groups[sector].changes.push(change);
      const cap = num(stock.marketCap);
      if (cap !== null) groups[sector].caps.push(cap);
    });
    const rows = Object.entries(groups).map(([name, group]) => ({ name, count: group.count, change: group.changes.length ? group.changes.reduce((a,b) => a+b,0) / group.changes.length : null, cap: group.caps.length ? group.caps.reduce((a,b) => a+b,0) : null })).sort((a,b) => (b.change ?? -Infinity) - (a.change ?? -Infinity));
    if (!rows.length) return '<p class="text-sm text-zinc-500 py-6 text-center">Sector analytics will appear with provider data.</p>';
    return `<div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">${rows.map((sector) => { const intensity = Math.min(Math.abs(sector.change || 0) / 5, 1); const bg = sector.change === null ? 'rgba(113,113,122,.1)' : sector.change >= 0 ? `rgba(16,185,129,${.08 + intensity * .25})` : `rgba(244,63,94,${.08 + intensity * .23})`; return `<div class="heat-cell p-4 rounded-xl border border-zinc-200/60 dark:border-zinc-700/60" style="background:${bg}"><div class="text-xs font-bold line-clamp-2">${escHtml(sector.name)}</div><div class="font-display font-extrabold text-2xl mt-3 ${tone(sector.change)}">${percent(sector.change)}</div><div class="text-[10px] text-zinc-500 mt-2">${sector.count} stocks${sector.cap !== null ? ' · KES ' + formatCompact(sector.cap) : ''}</div></div>`; }).join('')}</div>`;
  }
  function renderFixedIncome() {
    const income = fixedData();
    const cbr = cbrData();
    const inflation = inflationData();
    const offers = bills();
    return `<section id="fixed-income" class="space-y-5 scroll-mt-44"><div><span class="text-[10px] font-mono uppercase tracking-wider text-[#FF4D1C]">03 · Rates & public debt</span><h2 class="font-display font-extrabold text-2xl sm:text-3xl mt-1">Fixed income & monetary policy</h2><p class="text-sm text-zinc-500 mt-2">Official CBK policy settings and on-offer Treasury bill terms. Previous auction averages are not presented as completed current results.</p></div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">${renderMetric('Central bank rate', num(cbr.rate) !== null ? formatNumber(cbr.rate,2) + '%' : '—', sourceLine(cbr, 'rate date'))}${renderMetric('Annual average inflation', num(inflation.annualAverage) !== null ? formatNumber(inflation.annualAverage,2) + '%' : '—', `${escHtml(inflation.month || '')} ${escHtml(inflation.year || '')} · ${sourceLine(inflation, 'observation month')}`)}${renderMetric('12-month inflation', num(inflation.twelveMonth) !== null ? formatNumber(inflation.twelveMonth,2) + '%' : '—', 'Official year-on-year measure')}</div>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-5"><div class="market-card p-5 sm:p-6"><div><div class="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Treasury bill curve</div><h3 class="font-display font-bold text-xl mt-1">Previous average rates</h3></div>${offers.length ? '<div class="chart-box mt-5"><canvas id="tbill-chart" aria-label="Treasury bill previous average rate curve" role="img"></canvas></div>' : '<p class="text-sm text-zinc-500 py-12 text-center">Treasury bill data is unavailable.</p>'}<p class="text-[10px] text-zinc-500 mt-2">${sourceLine(fixedData().treasuryBillsMeta || income)} · ${fetchedLine()} · Auction dates are schedule dates, not publication dates.</p></div><div class="market-card p-5 sm:p-6"><div><div class="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Next scheduled auction</div><h3 class="font-display font-bold text-xl mt-1">On-offer Treasury bills</h3></div><div class="mt-5 space-y-3">${offers.length ? offers.map((bill) => `<div class="p-4 rounded-xl bg-[#F5F5F7] dark:bg-zinc-900 flex items-center justify-between gap-4"><div><div class="font-display font-bold">${escHtml(bill.label || bill.tenorDays + '-day')}</div><div class="text-[10px] text-zinc-500 mt-1">Issue ${escHtml(bill.issueNumber)} · auction ${formatDate(bill.auctionDate,{day:'2-digit',month:'short'})}</div></div><div class="text-right"><div class="font-display font-extrabold text-2xl">${num(bill.previousAverageRate) !== null ? formatNumber(bill.previousAverageRate,4) + '%' : '—'}</div><div class="text-[9px] uppercase tracking-wider text-zinc-500">previous average</div></div></div>`).join('') : '<p class="text-sm text-zinc-500">No on-offer terms returned.</p>'}<p class="mt-4 text-[10px] leading-relaxed text-zinc-500">Auction and value dates are schedule dates, not publication dates. ${fetchedLine()}.</p></div></div></div>
      ${offers.length ? `<div class="market-card overflow-hidden"><div class="p-5 border-b border-[#E5E7EB] dark:border-zinc-800"><h3 class="font-display font-bold">Auction terms & reference rates</h3></div><div class="market-scroll"><table class="data-table"><thead><tr><th>Instrument</th><th>Issue</th><th>Auction date</th><th>Value date</th><th>Previous average</th><th>Status</th></tr></thead><tbody>${offers.map((bill) => `<tr><td class="font-bold">${escHtml(bill.label || bill.tenorDays + '-day T-bill')}</td><td class="font-mono">${escHtml(bill.issueNumber)}</td><td>${formatDate(bill.auctionDate,{day:'2-digit',month:'short',year:'numeric'})}</td><td>${formatDate(bill.valueDate,{day:'2-digit',month:'short',year:'numeric'})}</td><td class="font-mono font-bold">${num(bill.previousAverageRate) !== null ? formatNumber(bill.previousAverageRate,4) + '%' : '—'}</td><td><span class="px-2 py-1 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 text-[10px] font-semibold">On offer</span></td></tr>`).join('')}</tbody></table></div></div>` : ''}
    </section>`;
  }
  function renderForex() {
    const forex = forexData();
    const pairs = Array.isArray(forex.pairs) ? forex.pairs : [];
    return `<section id="forex" class="space-y-5 scroll-mt-44"><div><span class="text-[10px] font-mono uppercase tracking-wider text-[#FF4D1C]">04 · Foreign exchange</span><h2 class="font-display font-extrabold text-2xl sm:text-3xl mt-1">Official KES currency matrix</h2><p class="text-sm text-zinc-500 mt-2">CBK indicative reference rates, not realtime interbank quotes. All values refresh on the dashboard’s 60-second polling cycle.</p></div>
      <div class="market-card p-5 sm:p-6"><div class="flex flex-col lg:flex-row lg:items-end justify-between gap-4"><div><h3 class="font-display font-bold text-xl">Currency converter</h3><p class="text-[11px] text-zinc-500 mt-1">${sourceLine(forex)}</p></div><div class="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full lg:w-auto"><label class="text-[10px] uppercase text-zinc-500">Amount<input id="fx-convert-amount" type="number" value="1000" oninput="convertFX()" class="mt-1 w-full min-w-0 px-3 py-2.5 rounded-lg bg-[#F5F5F7] dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 font-mono text-sm"></label><label class="text-[10px] uppercase text-zinc-500">From<select id="fx-convert-from" onchange="setFXSide('from',this.value)" class="mt-1 w-full px-3 py-2.5 rounded-lg bg-[#F5F5F7] dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm">${converterOptions(view.fxFrom,pairs)}</select></label><label class="text-[10px] uppercase text-zinc-500">To<select id="fx-convert-to" onchange="setFXSide('to',this.value)" class="mt-1 w-full px-3 py-2.5 rounded-lg bg-[#F5F5F7] dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm">${converterOptions(view.fxTo,pairs)}</select></label><div class="text-[10px] uppercase text-[#FF4D1C]">Converted<div id="fx-convert-result" class="mt-1 px-3 py-2.5 min-h-[42px] rounded-lg bg-[#0B0B0C] text-white font-mono text-sm normal-case tracking-normal">—</div></div></div></div></div>
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><input type="search" value="${escHtml(view.fxQuery)}" oninput="marketFXSearch(this.value)" placeholder="Filter currencies…" class="w-full sm:max-w-xs px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#12141A] border border-[#E5E7EB] dark:border-zinc-800 text-xs"><span class="text-[11px] text-zinc-500">KES per unit · inverse shown</span></div><div id="fx-pair-grid" class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">${renderFXPairs()}</div>
    </section>`;
  }
  function converterOptions(selected,pairs) { return `<option value="KES" ${selected === 'KES' ? 'selected' : ''}>KES</option>${pairs.map((pair) => `<option value="${escHtml(pair.code)}" ${selected === pair.code ? 'selected' : ''}>${escHtml(pair.code)}</option>`).join('')}`; }
  function renderFXPairs() {
    const pairs = (forexData().pairs || []).filter((pair) => `${pair.code} ${pair.name}`.toLowerCase().includes(view.fxQuery.toLowerCase()));
    if (!pairs.length) return '<p class="col-span-full py-10 text-center text-sm text-zinc-500">No official currency rates match this filter.</p>';
    return pairs.map((pair) => `<div class="market-card p-4"><div class="flex items-center justify-between gap-2"><span class="font-mono font-bold text-sm">${escHtml(pair.code)}/KES</span><span class="text-[9px] uppercase tracking-wider text-zinc-500">CBK</span></div><div class="font-display font-extrabold text-xl mt-3 tabular">${formatNumber(pair.rate,['JPY','BIF','RWF','UGX','TZS'].includes(pair.code) ? 4 : 2)}</div><div class="text-[10px] text-zinc-500 mt-1 truncate">${escHtml(pair.name)}</div><div class="text-[10px] font-mono text-zinc-400 mt-3">1 KES = ${formatNumber(pair.inverse,4)} ${escHtml(pair.code)}</div></div>`).join('');
  }
  function renderMacro() {
    const inflation = inflationData();
    const cbr = cbrData();
    return `<section id="macro" class="space-y-5 scroll-mt-44"><div><span class="text-[10px] font-mono uppercase tracking-wider text-[#FF4D1C]">05 · Macro & history</span><h2 class="font-display font-extrabold text-2xl sm:text-3xl mt-1">Kenya’s rates and inflation trajectory</h2><p class="text-sm text-zinc-500 mt-2">Historical context from official CBK tables. Range controls sample the official series; they do not interpolate missing observations.</p></div>
      <div class="flex flex-wrap items-center justify-between gap-3"><p class="text-xs text-zinc-500">${macroInsight()}</p><div class="inline-flex rounded-lg bg-[#F5F5F7] dark:bg-zinc-900 p-0.5 text-xs">${[['1Y','1 year'],['3Y','3 years'],['ALL','All data']].map(([value,label]) => `<button onclick="setMacroRange('${value}')" class="px-3 py-1.5 rounded-md ${view.macroRange === value ? 'bg-white dark:bg-zinc-800 font-bold shadow-sm' : 'text-zinc-500'}">${label}</button>`).join('')}</div></div>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-5"><div class="market-card p-5 sm:p-6"><div class="flex items-start justify-between gap-3"><div><div class="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Price stability</div><h3 class="font-display font-bold text-xl mt-1">Inflation history</h3></div><span class="font-display font-extrabold text-2xl">${num(inflation.twelveMonth) !== null ? formatNumber(inflation.twelveMonth,2) + '%' : '—'}</span></div><div class="chart-box tall mt-5"><canvas id="inflation-chart" aria-label="Inflation history chart" role="img"></canvas></div><p class="text-[10px] text-zinc-500 mt-3">${sourceLine(inflation, 'observation month')}</p></div><div class="market-card p-5 sm:p-6"><div class="flex items-start justify-between gap-3"><div><div class="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Monetary policy</div><h3 class="font-display font-bold text-xl mt-1">Central bank rate history</h3></div><span class="font-display font-extrabold text-2xl">${num(cbr.rate) !== null ? formatNumber(cbr.rate,2) + '%' : '—'}</span></div><div class="chart-box tall mt-5"><canvas id="cbr-chart" aria-label="Central bank rate history chart" role="img"></canvas></div><p class="text-[10px] text-zinc-500 mt-3">${sourceLine(cbr, 'rate date')}</p></div></div>
    </section>`;
  }
  function macroInsight() {
    const history = inflationData().history || [];
    if (history.length < 2) return 'Official macro history is unavailable.';
    const latest = history.at(-1);
    const previous = history.at(-2);
    const change = num(latest.twelveMonth) - num(previous.twelveMonth);
    return `12-month inflation ${change > 0 ? 'rose' : change < 0 ? 'fell' : 'was unchanged'} ${Math.abs(change).toFixed(2)} percentage points from ${escHtml(previous.month || 'the previous release')}.`;
  }
  function renderNews() {
    return `<section id="news" class="space-y-5 scroll-mt-44"><div class="flex flex-wrap items-end justify-between gap-3"><div><span class="text-[10px] font-mono uppercase tracking-wider text-[#FF4D1C]">06 · Market catalysts</span><h2 class="font-display font-extrabold text-2xl sm:text-3xl mt-1">News moving the narrative</h2></div><a href="index.html?category=equity_markets" class="text-xs font-semibold text-[#FF4D1C]">All equity coverage →</a></div><div id="market-news">${view.articles.length ? `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">${view.articles.map(FC.renderGridCard).join('')}</div>` : '<div class="market-card p-8 text-center text-sm text-zinc-500">Loading attributed market coverage…</div>'}</div></section>`;
  }
  function renderSources() {
    const sources = view.payload?.officialSources || [];
    return `<section class="market-card p-6 sm:p-8"><div class="grid lg:grid-cols-3 gap-6"><div><span class="text-[10px] font-mono uppercase tracking-wider text-[#FF4D1C]">Data methodology</span><h2 class="font-display font-bold text-xl mt-2">Know what each number means</h2></div><div class="lg:col-span-2 grid sm:grid-cols-3 gap-4 text-xs leading-relaxed"><div><h3 class="font-bold">NSE provider data</h3><p class="text-zinc-500 mt-1">Live, delayed or end-of-day according to the configured provider; provider timestamps describe quote observations. Commercial redistribution requires an appropriate licence.</p></div><div><h3 class="font-bold">CBK reference data</h3><p class="text-zinc-500 mt-1">Official daily Forex and policy series. Observation/reference dates are separate from fetch time; daily reference rates are not executable interbank prices.</p></div><div><h3 class="font-bold">No simulated quotes</h3><p class="text-zinc-500 mt-1">Missing data stays unavailable. Derived breadth and sector means use only actual returned observations.</p></div></div></div><div class="flex flex-wrap gap-2 mt-6 pt-5 border-t border-[#E5E7EB] dark:border-zinc-800">${sources.map((source) => `<a href="${escHtml(FC.safeUrl(source.url))}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-lg bg-[#F5F5F7] dark:bg-zinc-900 text-[11px] font-semibold hover:text-[#FF4D1C]">${escHtml(source.name)} ↗</a>`).join('')}</div></section>`;
  }
  function render() {
    FC.renderPage = render;
    charts.splice(0).forEach((chart) => chart.destroy());
    if (view.loading && !view.payload) { root.innerHTML = renderSkeleton(); return; }
    if (view.error && !view.payload) { root.innerHTML = renderError(view.error); return; }
    root.innerHTML = `<div class="space-y-10 sm:space-y-12">${renderPageHeader()}${renderOverview()}${renderEquities()}${renderFixedIncome()}${renderForex()}${renderMacro()}${renderNews()}${renderSources()}</div>`;
    initCharts();
    updateClock();
    convertFX();
  }
  function chartDefaults() {
    const dark = document.documentElement.classList.contains('dark');
    return { responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false}, plugins:{legend:{labels:{color:dark?'#a1a1aa':'#52525b',boxWidth:10,usePointStyle:true}},tooltip:{backgroundColor:'#0B0B0C',padding:12,cornerRadius:8}}, scales:{x:{grid:{display:false},ticks:{color:'#71717a',maxTicksLimit:8}},y:{grid:{color:dark?'rgba(255,255,255,.06)':'rgba(0,0,0,.06)'},ticks:{color:'#71717a'}}} };
  }
  function makeLineChart(id, labels, datasets, yTitle = '') {
    const canvas = document.getElementById(id);
    if (!canvas || !window.Chart) return;
    const options = chartDefaults();
    options.scales.y.title = { display:Boolean(yTitle), text:yTitle, color:'#71717a' };
    charts.push(new Chart(canvas,{type:'line',data:{labels,datasets},options}));
  }
  function macroHistory(section) {
    const history = section.history || [];
    const now = new Date();
    const cutoff = view.macroRange === '1Y' ? new Date(now.getFullYear()-1,now.getMonth(),now.getDate()) : view.macroRange === '3Y' ? new Date(now.getFullYear()-3,now.getMonth(),now.getDate()) : null;
    return history.filter((point) => !cutoff || new Date(point.date) >= cutoff);
  }
  function initCharts() {
    const points = historyPoints(view.historyIndex);
    if (points.length) makeLineChart('index-history-chart',points.map((point) => point.date ? formatDate(point.date,{day:'2-digit',month:'short'}) : ''),[{label:view.historyIndex,data:points.map((point) => point.value),borderColor:'#FF4D1C',backgroundColor:'rgba(255,77,28,.10)',borderWidth:2,fill:true,tension:.25,pointRadius:0,pointHoverRadius:4}],'Index level');
    const offers = bills().filter((bill) => num(bill.previousAverageRate) !== null).sort((a,b) => a.tenorDays-b.tenorDays);
    if (offers.length) makeLineChart('tbill-chart',offers.map((bill) => bill.tenorDays + ' days'),[{label:'Previous average rate',data:offers.map((bill) => bill.previousAverageRate),borderColor:'#FF4D1C',backgroundColor:'rgba(255,77,28,.12)',borderWidth:2,fill:true,tension:.3,pointRadius:4}],'Percent');
    const inflation = macroHistory(inflationData());
    if (inflation.length) makeLineChart('inflation-chart',inflation.map((point) => formatDate(point.date,{month:'short',year:'2-digit'})),[{label:'12-month inflation',data:inflation.map((point) => point.twelveMonth),borderColor:'#FF4D1C',backgroundColor:'rgba(255,77,28,.08)',borderWidth:2,fill:true,tension:.25,pointRadius:0},{label:'Annual average',data:inflation.map((point) => point.annualAverage),borderColor:'#2563eb',borderWidth:1.5,borderDash:[5,4],fill:false,tension:.25,pointRadius:0}],'Percent');
    const cbr = macroHistory(cbrData());
    if (cbr.length) makeLineChart('cbr-chart',cbr.map((point) => formatDate(point.date,{month:'short',year:'2-digit'})),[{label:'Central bank rate',data:cbr.map((point) => point.rate),borderColor:'#10b981',backgroundColor:'rgba(16,185,129,.08)',borderWidth:2,fill:true,stepped:true,pointRadius:0}],'Percent');
  }
  async function loadMarketNews() {
    try {
      const [equity, fixed] = await Promise.all([loadNews({category:'equity_markets',limit:6}),loadNews({category:'fixed_income',limit:4})]);
      const unique = new Map();
      [...equity.articles,...fixed.articles].forEach((article) => unique.set(article.id,article));
      view.articles = [...unique.values()].sort((a,b) => new Date(b.publishedAt)-new Date(a.publishedAt)).slice(0,6);
    } catch { view.articles = []; }
    const target = document.getElementById('market-news');
    if (target) target.innerHTML = view.articles.length ? `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">${view.articles.map(FC.renderGridCard).join('')}</div>` : '<div class="market-card p-8 text-center text-sm text-zinc-500">Market coverage is temporarily unavailable.</div>';
  }
  async function refreshMarkets(manual = false) {
    if (view.refreshing) return;
    view.refreshing = true;
    view.loading = !view.payload;
    document.getElementById('refresh-icon')?.classList.add('spinning');
    try {
      const firstPayload = !view.payload;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 25000);
      try {
        view.payload = await fetchJSON('/api/markets', { cache: 'no-store', signal: controller.signal });
      } finally {
        window.clearTimeout(timeout);
      }
      if (firstPayload && view.payload?.nse?.indices?.[0]?.code && !view.payload.nse.history?.[view.historyIndex]) {
        view.historyIndex = view.payload.nse.indices[0].code;
      }
      view.error = null;
      view.refreshedAt = lastSuccessfulFetch(view.payload);
      render();
      if (firstPayload) scrollToHash();
      loadMarketNews();
      if (manual) FC.showToast('Market data refreshed');
    } catch (error) {
      view.error = error.message;
      render();
      if (manual) FC.showToast(`Refresh failed: ${error.message}`);
    } finally {
      view.loading = false;
      view.refreshing = false;
      document.getElementById('refresh-icon')?.classList.remove('spinning');
    }
  }
  function updateClock() {
    const clock = document.getElementById('market-clock');
    if (clock) clock.textContent = new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Africa/Nairobi'}) + ' EAT';
  }
  window.refreshMarkets = refreshMarkets;
  window.setHistoryIndex = (code) => { view.historyIndex = code; render(); };
  window.setMoverTab = (tab) => { view.moverTab = tab; document.getElementById('mover-list').innerHTML = renderMovers(); document.querySelectorAll('[onclick^="setMoverTab"]').forEach((button) => { const active = button.getAttribute('onclick').includes(`'${tab}'`); button.className = `px-2.5 py-1.5 rounded-md ${active ? 'bg-white dark:bg-zinc-800 font-bold' : 'text-zinc-500'}`; }); };
  window.marketStockSearch = (value) => { view.stockQuery = value; document.getElementById('stock-rows').innerHTML = renderStockRows(); document.getElementById('stock-count').textContent = filteredStocks().length + ' stocks'; };
  window.marketStockSector = (value) => { view.stockSector = value; document.getElementById('stock-rows').innerHTML = renderStockRows(); document.getElementById('stock-count').textContent = filteredStocks().length + ' stocks'; };
  window.marketStockSort = (key) => { view.stockSort = view.stockSort === key ? (key === 'ticker' || key === 'name' ? key : key) : key; render(); };
  window.marketFXSearch = (value) => { view.fxQuery = value; document.getElementById('fx-pair-grid').innerHTML = renderFXPairs(); };
  window.setFXSide = (side,value) => { view[side === 'from' ? 'fxFrom' : 'fxTo'] = value; convertFX(); };
  window.setMacroRange = (range) => { view.macroRange = range; render(); };
  function convertFX() {
    const output = document.getElementById('fx-convert-result');
    if (!output) return;
    const amount = Number(document.getElementById('fx-convert-amount')?.value) || 0;
    const pairs = forexData().pairs || [];
    const rate = (code) => code === 'KES' ? 1 : num(pairs.find((pair) => pair.code === code)?.rate);
    const from = rate(view.fxFrom), to = rate(view.fxTo);
    output.textContent = from && to ? `${formatNumber(amount * from / to,2)} ${view.fxTo}` : 'Unavailable';
  }
  window.convertFX = convertFX;
  window.exportStocks = () => {
    const rows = filteredStocks();
    if (!rows.length) { FC.showToast('No provider rows to export'); return; }
    const columns = ['ticker','name','sector','price','changePct','changeAbs','previousClose','volume','turnover','marketCap'];
    const csvCell = (value) => { let text = value ?? ''; if (/^[=+\-@]/.test(String(text))) text = "'" + text; return '"' + String(text).replace(/"/g,'""') + '"'; };
    const csv = [columns.join(','),...rows.map((stock) => columns.map((column) => csvCell(stock[column] ?? (column === 'changePct' ? changePercent(stock) : column === 'changeAbs' ? stock.change : ''))).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = `fincapita-nse-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  FC.refreshPage = () => refreshMarkets(true);
  window.addEventListener('fincapita:saved', loadMarketNews);
  window.addEventListener('fincapita:theme', render);
  window.addEventListener('hashchange', () => { if (view.payload) scrollToHash(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshMarkets(); });
  setInterval(() => { if (!document.hidden) refreshMarkets(); }, REFRESH_MS);
  setInterval(updateClock,1000);
  // Paint the loading state before the first network request starts.
  render();
  refreshMarkets();
})();
