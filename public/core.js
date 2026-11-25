(() => {
  const CATEGORY_LABELS = {
    all: 'All', equity_markets: 'Equities', corporate_developments: 'Corporate',
    fixed_income: 'Fixed Income', regulation_policy: 'Regulation', private_markets: 'Private Markets',
  };
  const ISSUERS = [
    { ticker: 'SCOM', name: 'Safaricom PLC', sector: 'Telecommunications' },
    { ticker: 'KCB', name: 'KCB Group PLC', sector: 'Banking' },
    { ticker: 'EQTY', name: 'Equity Group Holdings PLC', sector: 'Banking' },
    { ticker: 'COOP', name: 'Co-operative Bank of Kenya PLC', sector: 'Banking' },
    { ticker: 'EABL', name: 'East African Breweries PLC', sector: 'Manufacturing & Allied' },
    { ticker: 'KEGN', name: 'KenGen PLC', sector: 'Energy & Petroleum' },
    { ticker: 'CTUM', name: 'Centum Investment Company PLC', sector: 'Investment' },
    { ticker: 'KPLC', name: 'Kenya Power and Lighting PLC', sector: 'Energy & Petroleum' },
    { ticker: 'KQ', name: 'Kenya Airways PLC', sector: 'Transport' },
    { ticker: 'NCBA', name: 'NCBA Group PLC', sector: 'Banking' },
    { ticker: 'ABSA', name: 'Absa Bank Kenya PLC', sector: 'Banking' },
    { ticker: 'SCBK', name: 'Standard Chartered Kenya PLC', sector: 'Banking' },
    { ticker: 'BAMB', name: 'Bamburi Cement PLC', sector: 'Construction' },
    { ticker: 'SASN', name: 'Sasini PLC', sector: 'Agricultural' },
    { ticker: 'KUKZ', name: 'Kakuzi PLC', sector: 'Agricultural' },
    { ticker: 'BAT', name: 'BAT Kenya PLC', sector: 'Manufacturing' },
  ];
  const INSTITUTIONS = [
    { code: 'CMA', name: 'Capital Markets Authority', role: 'Capital Markets Regulator', website: 'https://www.cma.or.ke' },
    { code: 'CBK', name: 'Central Bank of Kenya', role: 'Monetary Authority & Debt Agent', website: 'https://www.centralbank.go.ke' },
    { code: 'NSE', name: 'Nairobi Securities Exchange PLC', role: 'Securities Exchange', website: 'https://www.nse.co.ke' },
    { code: 'CDSC', name: 'Central Depository & Settlement Corp.', role: 'Clearing & Settlement Depository', website: 'https://cdsckenya.com' },
    { code: 'TREASURY', name: 'The National Treasury', role: 'Fiscal & Public Debt Authority', website: 'https://www.treasury.go.ke' },
  ];
  const NAV_PAGES = [
    { id: 'frontpage', label: 'All News', href: 'index.html' },
    { id: 'markets', label: 'Markets', href: 'markets.html' },
    { id: 'companies', label: 'Companies', href: 'companies.html' },
    { id: 'institutions', label: 'Institutions', href: 'institutions.html' },
    { id: 'tools', label: 'Research & Tools', href: 'tools.html' },
    { id: 'saved', label: 'Saved & Alerts', href: 'saved.html' },
    { id: 'sources', label: 'Sources', href: 'sources.html' },
  ];
  const STORAGE_KEY = 'kcmip_prototype_v5';
  const defaults = {
    watchlist: ['SCOM', 'KCB', 'EQTY', 'CMA', 'CBK'], savedIds: [],
    alerts: [
      { id: 'AL-101', target: 'SCOM', condition: 'Dividend or earnings coverage', channel: 'On-site watch rule', enabled: true },
      { id: 'AL-102', target: 'CBK / CMA', condition: 'Auctions and regulatory circulars', channel: 'On-site watch rule', enabled: true },
    ],
    cashFlows: [
      { date: '2025-01-15', amount: -500000, note: 'Illustrative initial investment' },
      { date: '2025-08-31', amount: 42500, note: 'Illustrative dividend inflow' },
      { date: '2026-02-28', amount: 48000, note: 'Illustrative dividend inflow' },
      { date: '2026-11-20', amount: 535000, note: 'Illustrative exit value' },
    ],
  };
  const state = { ...defaults, articles: [], sources: [], health: null, activePage: document.body.dataset.page || 'frontpage' };
  ['watchlist', 'savedIds', 'alerts', 'cashFlows'].forEach((key) => { state[key] = [...defaults[key]]; });
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved) ['watchlist', 'savedIds', 'alerts', 'cashFlows'].forEach((key) => {
      if (Array.isArray(saved[key])) state[key] = saved[key];
    });
  } catch {}

  const root = document.getElementById('app-workspace');
  const page = state.activePage;
  const fx = { data: null, index: 0, rotateTimer: null, refreshTimer: null, loading: false, promise: null };
  let toastTimer;
  let searchTimer;

  function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function safeUrl(value, image = false) {
    try {
      const url = new URL(String(value || ''), location.href);
      if (image ? ['http:', 'https:'].includes(url.protocol) : ['http:', 'https:'].includes(url.protocol)) return url.href;
    } catch {}
    return '';
  }
  function secureImageUrl(value) {
    const href = safeUrl(value, true);
    if (!href) return '';
    try {
      const url = new URL(href);
      const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
      if (url.protocol === 'http:' && !local && (!url.port || url.port === '443')) url.protocol = 'https:';
      return url.href;
    } catch { return ''; }
  }
  async function fetchJSON(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(['watchlist', 'savedIds', 'alerts', 'cashFlows'].map((key) => [key, state[key]]))));
    } catch {}
  }
  function normalizeArticle(article) {
    return {
      id: String(article.id || ''), title: String(article.title || 'Untitled'), sourceName: String(article.sourceName || article.actualSourceName || 'Source'),
      category: article.category || 'equity_markets', categoryLabel: CATEGORY_LABELS[article.category] || 'Markets',
      publishedAt: article.publishedAt || article.collectedAt || new Date().toISOString(), relativeTime: timeAgo(article.publishedAt || article.collectedAt),
      excerpt: String(article.summary || article.excerpt || ''), contentHtml: article.contentHtml || '', rewrittenHtml: article.rewrittenHtml || '',
      rewriteMethod: article.rewriteMethod || null, byline: article.byline || '', wordCount: Number(article.wordCount || 0),
      readingTimeMinutes: Number(article.readingTimeMinutes || 0), fullTextStatus: article.fullTextStatus || 'pending',
      tickers: Array.isArray(article.tickers) ? article.tickers : [], institutions: Array.isArray(article.institutions) ? article.institutions : [],
      imageUrl: secureImageUrl(article.imageUrl), sourceUrl: safeUrl(article.originalUrl || article.sourceUrl),
      importance: Number(article.importance || 0), rights: article.contentAccess || article.rights,
    };
  }
  async function loadNews(params = {}) {
    const query = new URLSearchParams({ limit: String(params.limit || 24), offset: String(params.offset || 0) });
    ['category', 'ticker', 'q', 'sort'].forEach((key) => { if (params[key] && params[key] !== 'all') query.set(key, params[key]); });
    const data = await fetchJSON('/api/news?' + query);
    return { ...data, articles: (data.articles || []).map(normalizeArticle) };
  }
  function timeAgo(iso) {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (!Number.isFinite(mins)) return 'recently';
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return `${Math.floor(mins / 1440)}d ago`;
  }
  function formatEAT(iso) {
    try { return new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' EAT'; }
    catch { return String(iso || '—'); }
  }
  function formatDate(iso, options = {}) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso);
    return date.toLocaleDateString('en-GB', options);
  }
  function formatCompact(value) {
    if (value === null || value === undefined || value === '') return '—';
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    const abs = Math.abs(number);
    if (abs >= 1e12) return (number / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return (number / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return (number / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return (number / 1e3).toFixed(1) + 'K';
    return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  function formatNumber(value, digits = 2) {
    if (value === null || value === undefined || value === '') return '—';
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
  }
  function percent(value, digits = 2) {
    if (value === null || value === undefined || value === '') return '—';
    const number = Number(value);
    return Number.isFinite(number) ? `${number >= 0 ? '+' : ''}${number.toFixed(digits)}%` : '—';
  }
  function tone(value) { return Number(value) > 0 ? 'text-emerald-600 dark:text-emerald-400' : Number(value) < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-500'; }
  function isSaved(id) { return state.savedIds.includes(String(id)); }
  function sourceByline(article) { return `<span class="text-[11px] text-zinc-400 dark:text-zinc-500">${escHtml(article.sourceName)}</span>`; }
  function canDisplayArticleImage(article) {
    const restrictedStatuses = new Set(['paywalled', 'blocked', 'pending', 'excerpt_only', 'metadata_only']);
    const restrictedRights = new Set(['paywalled', 'blocked', 'metadata_only', 'excerpt_only']);
    const status = String(article.fullTextStatus || 'pending').toLowerCase();
    const rights = String(article.contentAccess || article.rights || '').toLowerCase();
    if (!restrictedStatuses.has(status)) return true;
    return Boolean(article) && !restrictedRights.has(rights);
  }

  function articleImage(article) {
    const src = secureImageUrl(article.imageUrl);
    if (!src || !canDisplayArticleImage(article)) return '';
    return `<div class="relative h-full w-full overflow-hidden">${noImageHeader(article, true)}<img data-article-image src="${escHtml(src)}" alt="${escHtml(article.title)}" loading="lazy" decoding="async" class="absolute inset-0 h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"></div>`;
  }
  function noImageHeader(article, embedded = false) {
    return `<div class="${embedded ? 'absolute inset-0' : 'aspect-video'} bg-gradient-to-br from-[#0B0B0C] via-[#14161B] to-[#1F242D] relative overflow-hidden flex items-end">
      <div class="absolute inset-0 opacity-[0.06]" style="background-image:repeating-linear-gradient(45deg,#fff 0 1px,transparent 1px 12px)"></div>
      <div class="relative p-5"><div class="text-[10px] font-mono uppercase tracking-wider text-[#FF4D1C] font-bold mb-1">${escHtml(article.categoryLabel)}</div><div class="font-display font-bold text-sm text-white/90">${escHtml(article.sourceName)}</div><div class="text-[10px] text-zinc-400 mt-1">Image unavailable</div></div>
    </div>`;
  }
  function articleUrl(id) { return `article.html?id=${encodeURIComponent(id)}`; }
  function issuerUrl(ticker) { return `issuer.html?ticker=${encodeURIComponent(ticker)}`; }
  function openArticle(id) { location.href = articleUrl(id); }
  function openIssuer(ticker) { location.href = issuerUrl(ticker); }
  function renderGridCard(article) {
    const saved = isSaved(article.id);
    return `<article class="group rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] overflow-hidden flex flex-col justify-between hover:shadow-lg hover:-translate-y-0.5 transition-all">
      <a href="${articleUrl(article.id)}" class="block">
        <div class="aspect-video w-full overflow-hidden bg-[#F5F5F7] dark:bg-zinc-900">${articleImage(article) || noImageHeader(article)}</div>
        <div class="p-5">
          <div class="flex items-center gap-2 text-xs mb-2 flex-wrap"><span class="font-semibold text-[#FF4D1C]">${escHtml(article.categoryLabel)}</span><span class="text-zinc-400">·</span><span class="text-zinc-500 dark:text-zinc-400">${escHtml(article.relativeTime)}</span><span class="text-zinc-400">·</span>${sourceByline(article)}</div>
          <h3 class="font-display font-bold text-lg leading-snug text-[#111315] dark:text-white group-hover:text-[#FF4D1C] transition-colors line-clamp-2">${escHtml(article.title)}</h3>
          <p class="mt-2 text-xs text-[#5F6368] dark:text-zinc-400 leading-relaxed line-clamp-2">${escHtml(article.excerpt || 'Open to read summary and source link.')}</p>
          <div class="mt-3 flex flex-wrap gap-1.5">${article.tickers.slice(0, 3).map((ticker) => `<span class="px-2 py-0.5 rounded bg-[#F5F5F7] dark:bg-zinc-800 font-mono text-[10px] font-semibold">NSE:${escHtml(ticker)}</span>`).join('')}</div>
        </div>
      </a>
      <div class="px-5 py-3 border-t border-[#E5E7EB] dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs">
        <button data-save-article="${escHtml(article.id)}" class="font-semibold ${saved ? 'text-[#FF4D1C]' : 'text-zinc-500 hover:text-[#111315] dark:hover:text-white'}">${saved ? 'Saved' : '+ Save'}</button>
        <a href="${escHtml(article.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#FF4D1C] text-white text-[10px] font-bold hover:bg-[#E03D10]">Open original <span aria-hidden="true">→</span></a>
      </div>
    </article>`;
  }
  function renderSkeleton() {
    return `<div class="space-y-10" aria-label="Loading content"><div class="grid grid-cols-1 lg:grid-cols-12 gap-8"><div class="lg:col-span-7 space-y-4"><div class="skeleton h-4 w-40 rounded"></div><div class="skeleton h-10 w-full rounded"></div><div class="skeleton h-10 w-4/5 rounded"></div><div class="skeleton aspect-video w-full rounded-2xl"></div></div><div class="lg:col-span-5 space-y-6">${[1,2,3].map(() => `<div class="flex gap-4"><div class="flex-1 space-y-2"><div class="skeleton h-4 w-full rounded"></div><div class="skeleton h-4 w-3/4 rounded"></div><div class="skeleton h-3 w-1/2 rounded"></div></div><div class="skeleton w-28 sm:w-32 aspect-[4/3] rounded-xl"></div></div>`).join('')}</div></div><div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">${[1,2,3,4,5,6].map(() => `<div class="rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 overflow-hidden"><div class="skeleton aspect-video"></div><div class="p-5 space-y-2"><div class="skeleton h-3 w-24 rounded"></div><div class="skeleton h-5 w-full rounded"></div><div class="skeleton h-3 w-3/4 rounded"></div></div></div>`).join('')}</div></div>`;
  }
  function renderError(message = 'Content could not be loaded.') {
    return `<div class="py-20 text-center rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 bg-[#F5F5F7] dark:bg-zinc-900/50 space-y-4 max-w-xl mx-auto"><h3 class="font-display font-bold text-lg">Something interrupted the feed</h3><p class="text-sm text-zinc-500">${escHtml(message)}</p><button onclick="location.reload()" class="px-4 py-2 rounded-lg bg-[#FF4D1C] text-white text-xs font-bold">Try again</button></div>`;
  }
  function renderEmpty(message) {
    return `<div class="py-16 text-center rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-[#F5F5F7] dark:bg-zinc-900/50 px-5"><h3 class="font-display font-bold text-lg">${escHtml(message)}</h3><p class="text-sm text-zinc-500 mt-1">Try another filter or return to the latest intelligence feed.</p></div>`;
  }
  function pageHeading(eyebrow, title, description = '') {
    return `<div><span class="text-xs font-bold uppercase tracking-[0.16em] text-[#FF4D1C]">${escHtml(eyebrow)}</span><h1 class="font-display font-extrabold text-3xl sm:text-4xl tracking-tight mt-1">${escHtml(title)}</h1>${description ? `<p class="text-sm text-[#5F6368] dark:text-zinc-400 mt-2 max-w-2xl">${escHtml(description)}</p>` : ''}</div>`;
  }
  function showToast(message) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-msg').textContent = message;
    toast.classList.remove('opacity-0');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('opacity-0'), 2800);
  }
  function toggleSaveArticle(id) {
    const key = String(id);
    const index = state.savedIds.indexOf(key);
    if (index >= 0) { state.savedIds.splice(index, 1); showToast('Removed from saved library'); }
    else { state.savedIds.push(key); showToast('Saved to your reading library'); }
    saveState();
    renderNavigation();
    window.dispatchEvent(new CustomEvent('fincapita:saved', { detail: key }));
  }
  function toggleWatchlist(symbol) {
    const index = state.watchlist.indexOf(symbol);
    if (index >= 0) { state.watchlist.splice(index, 1); showToast(`Unfollowed ${symbol}`); }
    else { state.watchlist.push(symbol); showToast(`Following ${symbol}`); }
    saveState();
    window.dispatchEvent(new CustomEvent('fincapita:watchlist'));
  }
  function toggleTheme() {
    const dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('fincapita-theme', dark ? 'dark' : 'light'); } catch {}
    window.dispatchEvent(new CustomEvent('fincapita:theme', { detail: dark ? 'dark' : 'light' }));
  }
  function toggleMobileDrawer() {
    const drawer = document.getElementById('mobile-drawer');
    drawer.classList.toggle('hidden');
    document.querySelector('[aria-controls="mobile-drawer"]')?.setAttribute('aria-expanded', String(!drawer.classList.contains('hidden')));
  }
  function toggleFilterBar() {
    const drawer = document.getElementById('multi-filter-drawer');
    drawer.classList.toggle('hidden');
    document.querySelector('[aria-controls="multi-filter-drawer"]')?.setAttribute('aria-expanded', String(!drawer.classList.contains('hidden')));
  }
  function openPricingModal() { document.getElementById('pricing-modal').classList.remove('hidden'); }
  function closePricingModal() { document.getElementById('pricing-modal').classList.add('hidden'); }
  function navigateFeed(params = {}) {
    const query = new URLSearchParams();
    if (params.category && params.category !== 'all') query.set('category', params.category);
    if (params.ticker && params.ticker !== 'all') query.set('ticker', params.ticker);
    if (params.q?.trim()) query.set('q', params.q.trim());
    if (params.page > 1) query.set('page', params.page);
    location.href = 'index.html' + (query.size ? '?' + query : '');
  }
  function setFilter(key, value) {
    const current = new URLSearchParams(location.search);
    current.set(key, value);
    if (value === 'all') current.delete(key);
    current.delete('page');
    location.href = 'index.html' + (current.size ? '?' + current : '');
  }
  function resetFilters() { navigateFeed(); }
  function handleSearch(value) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (page === 'frontpage') window.dispatchEvent(new CustomEvent('fincapita:search', { detail: value }));
      else navigateFeed({ q: value });
    }, 350);
  }
  async function refreshNews() {
    showToast('Syncing source feeds…');
    try {
      const response = await fetch('/api/v1/ingest', { method: 'POST' });
      if (!response.ok) throw new Error('Ingestion service unavailable');
      showToast('Source sync complete');
      window.dispatchEvent(new CustomEvent('fincapita:newsrefresh'));
      if (page !== 'frontpage') setTimeout(() => location.reload(), 500);
    } catch (error) { showToast(`Refresh failed: ${error.message}`); }
  }
  function refreshCurrent() {
    if (typeof FC.refreshPage === 'function') FC.refreshPage();
    else refreshNews();
  }
  function renderNavigation() {
    const currentIssuer = page === 'issuer' ? 'companies' : page;
    const savedBadge = state.savedIds.length ? `<span class="ml-1 px-1.5 py-0.5 rounded-full bg-[#FF4D1C] text-white text-[9px] font-mono">${state.savedIds.length}</span>` : '';
    document.getElementById('top-nav-links').innerHTML = NAV_PAGES.map((item) => `<a href="${item.href}" class="px-3 py-1.5 rounded-lg transition-colors ${currentIssuer === item.id ? 'text-white bg-white/15 font-semibold' : 'text-zinc-300 hover:text-white hover:bg-white/5'}" ${currentIssuer === item.id ? 'aria-current="page"' : ''}>${item.label}${item.id === 'saved' ? savedBadge : ''}</a>`).join('');
    document.getElementById('mobile-nav-links').innerHTML = NAV_PAGES.map((item) => `<a href="${item.href}" onclick="toggleMobileDrawer()" class="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium ${currentIssuer === item.id ? 'bg-[#FF4D1C] text-white font-bold' : 'text-zinc-300 hover:bg-white/10'}">${item.label}${item.id === 'saved' ? savedBadge : ''}</a>`).join('');
  }
  function injectShell() {
    document.getElementById('site-shell').innerHTML = `
      <header class="sticky top-0 z-40 bg-[#0B0B0C] text-white border-b border-white/10">
        <div class="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-4">
          <a href="index.html" class="flex items-center gap-2.5 shrink-0 text-left"><img src="/logo.png" alt="FinCapita" class="w-8 h-8 rounded-lg object-contain"><div><span class="font-display font-extrabold text-lg tracking-tight text-white block leading-none">FinCapita</span><span class="text-[9px] font-mono uppercase tracking-[0.16em] text-zinc-400 block mt-0.5">Kenya Markets</span></div></a>
          <nav id="top-nav-links" class="hidden lg:flex items-center gap-1 text-[13px] font-medium" aria-label="Primary navigation"></nav>
          <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button onclick="refreshCurrent()" title="Refresh current page" class="hidden sm:inline-flex p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v6h6M20 20v-6h-6M20 8A8 8 0 0 0 5.1 6.1M4 16a8 8 0 0 0 14.9 1.9"/></svg></button>
            <button onclick="toggleTheme()" title="Toggle light or dark theme" class="p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10"><svg class="w-4 h-4 hidden dark:block" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41-1.41"/></svg><svg class="w-4 h-4 block dark:hidden" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></button>
            <button onclick="openPricingModal()" class="px-3 sm:px-4 py-2 rounded-lg bg-[#FF4D1C] hover:bg-[#E03D10] text-white font-display font-bold text-xs"><span class="sm:hidden">Pro</span><span class="hidden sm:inline">Subscribe</span></button>
            <button onclick="toggleMobileDrawer()" class="lg:hidden p-2 rounded-lg bg-white/10 text-white" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-drawer"><svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M4 6h16M4 12h16M4 18h16"/></svg></button>
          </div>
        </div>
        <div class="bg-[#F5F5F7] dark:bg-[#14161B] text-[#111315] dark:text-zinc-200 border-b border-[#E5E7EB] dark:border-zinc-800">
          <div class="utility-row max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-2 sm:gap-3">
            <button onclick="toggleFilterBar()" aria-label="Toggle filters" aria-controls="multi-filter-drawer" aria-expanded="false" class="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#0B0B0C] dark:bg-zinc-800 text-white text-xs font-medium shrink-0"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M4 6h16M4 12h10M4 18h14"/></svg><span class="hidden sm:inline">Filters</span></button>
            <div id="currency-ticker" class="fx-ticker flex items-center justify-center sm:justify-start gap-1.5 px-1.5 sm:px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 font-mono text-[10px] sm:text-[11px]" aria-live="polite">
              <span class="hidden sm:inline text-zinc-500">FX</span>
              <span id="fx-mobile" class="hidden items-center gap-1.5">Loading CBK rates…</span>
              <span id="fx-desktop" class="hidden sm:flex items-center gap-2"></span>
              <span id="fx-source" class="hidden xl:inline text-zinc-400 ml-1">CBK daily</span>
            </div>
            <div class="search-shell relative flex items-center"><input id="global-search" type="search" placeholder="Search SCOM, CBK, IFB…" oninput="handleSearch(this.value)" class="w-full transition-all pl-3 pr-8 py-1.5 rounded-md bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-[#111315] dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-[#FF4D1C]"><svg class="w-3.5 h-3.5 text-zinc-500 absolute right-2.5 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path stroke-linecap="round" d="m21 21-4.3-4.3"/></svg></div>
          </div>
          <div id="multi-filter-drawer" class="hidden border-t border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#111318]">
            <div class="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div class="flex flex-wrap items-center gap-2"><span class="font-mono text-[10px] uppercase text-zinc-500">Category</span><select id="filter-category" onchange="setFilter('category',this.value)" class="px-2.5 py-1.5 rounded-md bg-[#F5F5F7] dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs">${Object.entries(CATEGORY_LABELS).filter(([id]) => id !== 'all').map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select><span class="font-mono text-[10px] uppercase text-zinc-500 sm:ml-2">Issuer</span><select id="filter-ticker" onchange="setFilter('ticker',this.value)" class="px-2.5 py-1.5 rounded-md bg-[#F5F5F7] dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs"><option value="all">All NSE issuers</option>${ISSUERS.map((issuer) => `<option value="${issuer.ticker}">${issuer.ticker} · ${escHtml(issuer.name)}</option>`).join('')}</select></div>
              <button onclick="resetFilters()" class="px-2.5 py-1.5 font-semibold text-[#FF4D1C]">Reset all</button>
            </div>
          </div>
        </div>
      </header>
      <div id="mobile-drawer" class="fixed inset-0 z-50 hidden lg:hidden"><div onclick="toggleMobileDrawer()" class="fixed inset-0 bg-black/60"></div><div class="relative w-72 max-w-[82vw] h-full bg-[#0B0B0C] text-white p-5 flex flex-col justify-between z-10"><div><div class="flex items-center justify-between pb-4 border-b border-white/10"><span class="font-display font-extrabold text-base">FinCapita</span><button onclick="toggleMobileDrawer()" class="p-1.5 rounded-md bg-white/10 text-xs" aria-label="Close menu">✕</button></div><nav id="mobile-nav-links" class="mt-4 flex flex-col gap-1" aria-label="Mobile navigation"></nav></div><button onclick="toggleMobileDrawer();openPricingModal()" class="w-full py-2.5 rounded-lg bg-[#FF4D1C] text-white font-display font-bold text-xs">Subscribe · Intelligence Pro</button></div></div>
      <footer id="site-footer" class="border-t border-[#E5E7EB] dark:border-zinc-800 bg-[#F5F5F7] dark:bg-[#111318] mt-14"><div class="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-7 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-zinc-500 dark:text-zinc-400"><div><div class="font-display font-bold text-sm text-[#111315] dark:text-white">FinCapita · Kenya Capital Markets Intelligence</div><p class="mt-1 max-w-2xl">Independent market intelligence and research utilities. Not a broker, exchange, or investment adviser.</p></div><div class="font-mono text-[10px] sm:text-[11px] sm:text-right">SOURCE-ATTRIBUTED · KES<br><span id="footer-stat">CBK · NSE · CMA · CDSC</span></div></div></footer>
      <div id="pricing-modal" class="fixed inset-0 z-[60] hidden flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="FinCapita plans"><div onclick="closePricingModal()" class="fixed inset-0 bg-black/65"></div><div class="relative w-full max-w-2xl bg-white dark:bg-[#12141A] rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 shadow-2xl overflow-hidden z-10 max-h-[90dvh] overflow-y-auto"><div class="p-6 border-b border-[#E5E7EB] dark:border-zinc-800 bg-[#0B0B0C] text-white"><span class="text-[10px] font-mono uppercase tracking-wider text-[#FF4D1C]">FinCapita access</span><h2 class="font-display font-extrabold text-2xl mt-2">Public intelligence. Professional workflows.</h2><p class="text-zinc-300 text-xs mt-2">Public market news, official CBK series and research tools are available without an account.</p></div><div class="p-6 grid sm:grid-cols-2 gap-4"><div class="p-5 rounded-xl border border-[#E5E7EB] dark:border-zinc-800"><div class="text-xs font-bold uppercase text-zinc-500">Public</div><div class="font-display font-extrabold text-3xl mt-2">Free</div><ul class="mt-4 space-y-2 text-xs text-zinc-600 dark:text-zinc-300"><li>Attributed market news</li><li>Official rates and Treasury data</li><li>Research tools and watchlists</li></ul></div><div class="p-5 rounded-xl border-2 border-[#FF4D1C]"><div class="text-xs font-bold uppercase text-[#FF4D1C]">Professional workspace</div><div class="font-display font-extrabold text-3xl mt-2">Enquiry</div><p class="text-xs text-zinc-500 mt-4">Licensed NSE data, API access and team workflows require an appropriately licensed commercial feed.</p><button onclick="closePricingModal();showToast('Use the institution contact form to request a licensed workspace')" class="mt-5 w-full py-2.5 rounded-lg bg-[#FF4D1C] text-white text-xs font-bold">Request access</button></div></div><button onclick="closePricingModal()" class="absolute top-4 right-4 p-2 rounded-lg bg-white/10 text-white text-xs font-mono">ESC</button></div></div>
      <div id="toast" class="fixed bottom-5 right-5 z-[70] pointer-events-none opacity-0 transition-opacity duration-200"><div class="px-4 py-2.5 rounded-xl bg-[#0B0B0C] text-white text-xs shadow-xl border border-white/10 flex items-center gap-2.5"><span class="w-2 h-2 rounded-full bg-[#FF4D1C]"></span><span id="toast-msg">Ready</span></div></div>`;
    const footer = document.getElementById('site-footer');
    if (footer) root.after(footer);
    renderNavigation();
    const query = new URLSearchParams(location.search);
    const search = document.getElementById('global-search');
    if (query.has('q')) search.value = query.get('q');
    const category = document.getElementById('filter-category');
    const ticker = document.getElementById('filter-ticker');
    if (category) category.value = query.get('category') || 'all';
    if (ticker) ticker.value = query.get('ticker') || 'all';
  }
  function fxPairValue(pair) {
    const digits = ['JPY', 'BIF', 'RWF', 'UGX', 'TZS'].includes(pair.code) ? 4 : 2;
    const tier = ['USD', 'EUR', 'GBP'].includes(pair.code) ? 'primary' : ['CNY', 'JPY'].includes(pair.code) ? 'tertiary' : 'optional';
    return `<span class="fx-pair ${tier} whitespace-nowrap">${escHtml(pair.code)}/KES <strong class="font-medium">${formatNumber(pair.rate, digits)}</strong></span>`;
  }
  function renderFX() {
    const data = fx.data;
    const mobile = document.getElementById('fx-mobile');
    const desktop = document.getElementById('fx-desktop');
    const source = document.getElementById('fx-source');
    if (!mobile || !desktop || !source) return;
    if (!data?.available || !data.pairs?.length) {
      mobile.textContent = 'CBK FX unavailable';
      desktop.textContent = 'CBK FX unavailable';
      source.textContent = 'Retrying';
      return;
    }
    const pair = data.pairs[fx.index % data.pairs.length];
    const digits = ['JPY', 'BIF', 'RWF', 'UGX', 'TZS'].includes(pair.code) ? 4 : 2;
    mobile.innerHTML = `<span>${escHtml(pair.code)}/KES</span><strong class="text-emerald-600 dark:text-emerald-400">${formatNumber(pair.rate, digits)}</strong><span class="text-zinc-400">rotates 60s</span>`;
    document.getElementById('currency-ticker').title = `${data.source || 'Central Bank of Kenya'} daily reference rate for ${formatDate(data.asOf, { day: '2-digit', month: 'short', year: 'numeric' })}`;
    desktop.innerHTML = data.pairs.map(fxPairValue).join('');
    source.textContent = `${data.stale ? 'Stale · ' : ''}CBK ${formatDate(data.asOf, { day: '2-digit', month: 'short' })}`;
  }
  function refreshFX() {
    if (fx.promise) return fx.promise;
    fx.loading = true;
    fx.promise = fetchJSON('/api/fx')
      .then((data) => {
        if (data?.available) fx.data = data;
        else if (!fx.data) fx.data = data;
        renderFX();
      })
      .catch(() => { renderFX(); })
      .finally(() => { fx.loading = false; fx.promise = null; });
    return fx.promise;
  }
  function initFX() {
    refreshFX();
    fx.rotateTimer = setInterval(() => { fx.index += 1; renderFX(); }, 60000);
    fx.refreshTimer = setInterval(refreshFX, 60000);
  }
  function updateFooter(count = 0, sources = 0) {
    const element = document.getElementById('footer-stat');
    if (element) element.textContent = count ? `${count} ARTICLES · ${sources} SOURCES` : 'CBK · NSE · CMA · CDSC';
  }

  const FC = {
    CATEGORY_LABELS, ISSUERS, INSTITUTIONS, NAV_PAGES, PAGE_SIZE: 24, state, root, page,
    escHtml, safeUrl, secureImageUrl, fetchJSON, saveState, normalizeArticle, loadNews, timeAgo, formatEAT, formatDate,
    canDisplayArticleImage, formatCompact, formatNumber, percent, tone, isSaved, articleImage, noImageHeader, articleUrl, issuerUrl, sourceByline,
    openArticle, openIssuer, renderGridCard, renderSkeleton, renderError, renderEmpty, pageHeading, showToast,
    toggleSaveArticle, toggleWatchlist, toggleTheme, toggleMobileDrawer, toggleFilterBar, openPricingModal,
    closePricingModal, navigateFeed, setFilter, resetFilters, refreshNews, refreshCurrent, updateFooter, handleSearch,
    getFX: () => fx.data, refreshFX,
    renderPage: null, refreshPage: null,
  };
  window.FC = FC;
  [
    'escHtml', 'fetchJSON', 'formatEAT', 'formatCompact', 'renderGridCard', 'renderSkeleton', 'renderError',
    'showToast', 'toggleSaveArticle', 'toggleWatchlist', 'toggleTheme', 'toggleMobileDrawer', 'toggleFilterBar',
    'openPricingModal', 'closePricingModal', 'refreshCurrent', 'refreshNews', 'navigateFeed', 'setFilter',
    'resetFilters', 'handleSearch', 'openArticle', 'openIssuer', 'toggleSaveArticle',
  ].forEach((name) => { window[name] = FC[name]; });
  window.computeXIRR = computeXIRR;
  window.renderFXList = renderFXList;
  window.renderWHTNet = renderWHTNet;
  window.addCashFlow = () => { state.cashFlows.push({ date: '2026-12-31', amount: 18500, note: 'Dividend / coupon receipt' }); saveState(); window.dispatchEvent(new CustomEvent('fincapita:cashflows')); };
  window.editCashFlow = (index, key, value) => { if (state.cashFlows[index]) { state.cashFlows[index][key] = value; saveState(); window.dispatchEvent(new CustomEvent('fincapita:cashflows')); } };
  window.deleteCashFlow = (index) => { if (state.cashFlows.length > 2) { state.cashFlows.splice(index, 1); saveState(); window.dispatchEvent(new CustomEvent('fincapita:cashflows')); } else showToast('At least two cash flows are required'); };
  window.addAlertRule = () => { state.alerts.unshift({ id: 'AL-' + Date.now(), target: 'EABL', condition: 'Dividend or corporate filing', channel: 'On-site watch rule', enabled: true }); saveState(); window.dispatchEvent(new CustomEvent('fincapita:alerts')); showToast('Local watch rule added'); };
  window.toggleAlert = (id) => { const alert = state.alerts.find((item) => item.id === id); if (alert) { alert.enabled = !alert.enabled; saveState(); window.dispatchEvent(new CustomEvent('fincapita:alerts')); } };

  function computeXIRR(flows) {
    const valid = flows.filter((flow) => flow.date && Number.isFinite(Number(flow.amount)) && Number(flow.amount) !== 0);
    if (valid.length < 2 || !valid.some((flow) => flow.amount > 0) || !valid.some((flow) => flow.amount < 0)) return null;
    const sorted = [...valid].sort((a, b) => new Date(a.date) - new Date(b.date));
    const dates = sorted.map((flow) => new Date(flow.date).getTime());
    if (dates.some((date) => !Number.isFinite(date))) return null;
    const start = dates[0];
    const times = dates.map((date) => (date - start) / (365 * 86400000));
    if (!times.some((time) => time > 0)) return null;
    const amounts = sorted.map((flow) => Number(flow.amount));
    const scale = amounts.reduce((sum, amount) => sum + Math.abs(amount), 0);
    const tolerance = scale * 1e-10;
    const evaluate = (rate) => {
      let value = 0, derivative = 0;
      for (let k = 0; k < amounts.length; k++) {
        const discount = Math.pow(1 + rate, times[k]);
        value += amounts[k] / discount;
        derivative -= times[k] * amounts[k] / (discount * (1 + rate));
      }
      return { value, derivative };
    };
    let rate = .12;
    let converged = false;
    for (let i = 0; i < 80; i++) {
      const { value, derivative } = evaluate(rate);
      if (!Number.isFinite(value) || !Number.isFinite(derivative)) break;
      if (Math.abs(value) <= tolerance) { converged = true; break; }
      if (Math.abs(derivative) <= scale * 1e-14) break;
      rate = rate - value / derivative;
      if (rate <= -1 || !Number.isFinite(rate)) return null;
    }
    if (!converged || !Number.isFinite(rate)) return null;
    return Math.abs(evaluate(rate).value) <= tolerance ? rate : null;
  }
  async function renderFXList() {
    const amount = document.getElementById('fx-amount');
    const box = document.getElementById('fx-results');
    if (!amount || !box) return;
    const kes = Number(amount.value) || 0;
    if (!fx.data?.pairs?.length) { box.innerHTML = '<p class="py-4 text-zinc-500">Official CBK rates are unavailable.</p>'; return; }
    box.innerHTML = fx.data.pairs.map((pair) => {
      const inverse = pair.inverse === null || pair.inverse === undefined || pair.inverse === '' ? null : Number(pair.inverse);
      const converted = inverse !== null && Number.isFinite(inverse) ? kes * inverse : null;
      return `<div class="py-2.5 flex items-center justify-between gap-3"><span><strong>${escHtml(pair.code)}</strong> <span class="text-zinc-400">${escHtml(pair.name)}</span></span><strong class="text-right">${formatNumber(converted, 2)} ${escHtml(pair.code)}</strong></div>`;
    }).join('');
  }
  function renderWHTNet() {
    const gross = document.getElementById('wht-gross');
    const tax = document.getElementById('wht-tax');
    const output = document.getElementById('wht-net-out');
    if (gross && tax && output) output.textContent = ((Number(gross.value) || 0) * (1 - (Number(tax.value) || 0))).toFixed(2) + '%';
  }

  document.addEventListener('error', (event) => {
    if (event.target instanceof HTMLImageElement && event.target.hasAttribute('data-article-image')) event.target.hidden = true;
  }, true);
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-save-article]');
    if (button) FC.toggleSaveArticle(button.dataset.saveArticle);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closePricingModal();
    document.getElementById('mobile-drawer')?.classList.add('hidden');
    document.querySelector('[aria-controls="mobile-drawer"]')?.setAttribute('aria-expanded', 'false');
  });
  injectShell();
  initFX();
})();
