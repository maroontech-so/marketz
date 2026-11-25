(() => {
  const { root, state, loadNews, fetchJSON, articleImage, canDisplayArticleImage, noImageHeader, renderGridCard, renderSkeleton, renderError, renderEmpty, pageHeading, articleUrl, sourceByline, updateFooter, escHtml, tone, percent } = FC;
  const params = new URLSearchParams(location.search);
  const requestedPage = Number(params.get('page'));
  const PAGE_SIZE = 24;
  const feed = {
    articles: [], total: 0, totalPages: 1, page: Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1,
    category: params.get('category') || 'all', ticker: params.get('ticker') || 'all', q: params.get('q') || '',
    sort: params.get('sort') || 'chronological', loading: true, error: null, sources: [],
  };
  function query() {
    return { limit: PAGE_SIZE, offset: (feed.page - 1) * PAGE_SIZE, category: feed.category, ticker: feed.ticker, q: feed.q, sort: feed.sort };
  }
  function activeFilters() { return feed.category !== 'all' || feed.ticker !== 'all' || Boolean(feed.q.trim()); }
  function categoryTabs() {
    return `<div class="flex items-center gap-2 overflow-x-auto pb-1" aria-label="News categories">${Object.entries(FC.CATEGORY_LABELS).map(([id, label]) => `<a href="index.html?${new URLSearchParams({ ...(feed.q ? { q: feed.q } : {}), ...(feed.ticker !== 'all' ? { ticker: feed.ticker } : {}), ...(feed.sort !== 'chronological' ? { sort: feed.sort } : {}), ...(id !== 'all' ? { category: id } : {}) })}" class="px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${feed.category === id ? 'bg-[#0B0B0C] text-white dark:bg-[#FF4D1C]' : 'bg-[#F5F5F7] dark:bg-zinc-900 text-[#5F6368] dark:text-zinc-400 hover:text-[#111315] dark:hover:text-white'}">${label}</a>`).join('')}</div>`;
  }
  function pagination() {
    if (feed.totalPages <= 1) return '';
    const from = (feed.page - 1) * PAGE_SIZE + 1;
    const to = Math.min(feed.page * PAGE_SIZE, feed.total);
    const pageLink = (number, label) => `<a href="index.html?${new URLSearchParams({ ...(feed.page > 1 || number !== 1 ? { page: String(number) } : {}), ...(feed.category !== 'all' ? { category: feed.category } : {}), ...(feed.ticker !== 'all' ? { ticker: feed.ticker } : {}), ...(feed.q ? { q: feed.q } : {}), ...(feed.sort !== 'chronological' ? { sort: feed.sort } : {}) })}" class="px-3 py-1.5 rounded-lg border border-[#E5E7EB] dark:border-zinc-700 bg-white dark:bg-[#12141A] text-xs font-semibold ${number === feed.page ? 'bg-[#FF4D1C] text-white border-[#FF4D1C]' : 'text-zinc-600 dark:text-zinc-300 hover:border-[#FF4D1C]'}">${label}</a>`;
    const numbers = Array.from({ length: feed.totalPages }, (_, index) => index + 1).filter((number) => number === 1 || number === feed.totalPages || Math.abs(number - feed.page) <= 2).map((number, index, list) => `${index && number - list[index - 1] > 1 ? '<span class="px-1 text-zinc-400">…</span>' : ''}${pageLink(number, number)}`).join('');
    return `<nav class="flex flex-wrap items-center justify-between gap-4 pt-6 border-t border-[#E5E7EB] dark:border-zinc-800" aria-label="Article pages"><div class="text-xs text-zinc-500">Showing <strong>${from}</strong>–<strong>${to}</strong> of <strong>${feed.total}</strong></div><div class="flex flex-wrap items-center gap-2">${feed.page > 1 ? pageLink(feed.page - 1, 'Previous') : '<span class="px-3 py-1.5 text-xs text-zinc-400">Previous</span>'}${numbers}${feed.page < feed.totalPages ? pageLink(feed.page + 1, 'Next') : '<span class="px-3 py-1.5 text-xs text-zinc-400">Next</span>'}</div></nav>`;
  }
  function render() {
    FC.renderPage = render;
    if (feed.loading) { root.innerHTML = renderSkeleton(); return; }
    if (feed.error) { root.innerHTML = renderError(feed.error); return; }
    if (!feed.articles.length) {
      root.innerHTML = `${pageHeading('Capital markets intelligence', 'All News', 'Verified Kenyan market reporting, disclosures and analysis from attributed sources.')}<div class="mt-8">${renderEmpty(activeFilters() ? 'No articles match these filters.' : 'No articles have been ingested yet.')}</div>`;
      return;
    }
    if (activeFilters()) {
      root.innerHTML = `<div class="space-y-6"><div class="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-[#E5E7EB] dark:border-zinc-800"><div><span class="text-xs font-semibold uppercase tracking-wider text-[#FF4D1C]">Filtered intelligence</span><h1 class="font-display font-extrabold text-2xl sm:text-3xl mt-1">${feed.total} matching ${feed.total === 1 ? 'article' : 'articles'}</h1>${feed.q ? `<p class="text-sm text-zinc-500 mt-1">Search: “${escHtml(feed.q)}”</p>` : ''}</div><a href="index.html" class="px-3.5 py-2 rounded-lg bg-[#0B0B0C] dark:bg-zinc-800 text-white text-xs font-semibold">Reset filters</a></div>${categoryTabs()}<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">${feed.articles.map(renderGridCard).join('')}</div>${pagination()}</div>`;
      return;
    }
    const [lead, ...rest] = feed.articles;
    root.innerHTML = `<div class="space-y-10 sm:space-y-12">
      <section class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-9 items-start">
        <article class="lg:col-span-7 xl:col-span-7 group">
          <a href="${articleUrl(lead.id)}" class="block"><div class="flex items-center gap-3 mb-4"><div class="w-9 h-9 rounded-full bg-[#0B0B0C] dark:bg-zinc-800 text-white flex items-center justify-center font-display font-extrabold text-xs shrink-0">${escHtml(lead.sourceName.slice(0,2).toUpperCase())}</div><div class="min-w-0"><div class="text-xs font-bold truncate">${escHtml(lead.sourceName)}</div><div class="text-[11px] text-zinc-500 truncate">${escHtml(lead.categoryLabel)} · ${escHtml(lead.relativeTime)}</div></div></div><h1 class="font-display font-extrabold text-3xl sm:text-4xl xl:text-[42px] leading-[1.12] tracking-[-0.025em] group-hover:text-[#FF4D1C] transition-colors">${escHtml(lead.title)}</h1><div class="mt-3.5 flex flex-wrap items-center gap-2 text-xs"><span class="font-semibold text-[#FF4D1C]">${escHtml(lead.categoryLabel)}</span><span class="text-zinc-400">·</span><span class="text-zinc-500">${escHtml(lead.relativeTime)}</span>${lead.tickers.slice(0,2).map((ticker) => `<span class="px-2 py-0.5 rounded bg-[#F5F5F7] dark:bg-zinc-800 font-mono text-[11px]">NSE:${escHtml(ticker)}</span>`).join('')}</div><div class="mt-5 rounded-2xl overflow-hidden bg-[#F5F5F7] dark:bg-zinc-900 border border-[#E5E7EB] dark:border-zinc-800 aspect-video">${articleImage(lead) || noImageHeader(lead)}</div><p class="mt-4 text-sm text-[#5F6368] dark:text-zinc-300 leading-relaxed line-clamp-3">${escHtml(lead.excerpt)}</p></a>
        </article>
        <div class="lg:col-span-5 divide-y divide-[#E5E7EB] dark:divide-zinc-800">${rest.slice(0,5).map((item) => `<article class="py-5 first:pt-0 flex items-start justify-between gap-4 group"><a href="${articleUrl(item.id)}" class="flex-1 min-w-0"><h2 class="font-display font-bold text-base sm:text-[17px] leading-snug group-hover:text-[#FF4D1C] line-clamp-2">${escHtml(item.title)}</h2><p class="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed line-clamp-2">${escHtml(item.excerpt)}</p><div class="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]"><span class="font-semibold text-[#FF4D1C]">${escHtml(item.categoryLabel)}</span><span class="text-zinc-400">·</span><span class="text-zinc-500">${escHtml(item.relativeTime)}</span><span class="text-zinc-400">·</span>${sourceByline(item)}</div></a>${item.imageUrl && canDisplayArticleImage(item) ? `<a href="${articleUrl(item.id)}" class="w-24 sm:w-32 aspect-[4/3] rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-900 shrink-0">${articleImage(item)}</a>` : ''}</article>`).join('')}</div>
      </section>
      <section class="space-y-6 pt-2 border-t border-[#E5E7EB] dark:border-zinc-800"><div class="flex flex-wrap items-center justify-between gap-4"><h2 class="font-display font-extrabold text-2xl sm:text-[26px] tracking-tight">Latest intelligence <span class="ml-2 font-mono text-sm font-normal text-zinc-500">${feed.total}</span></h2><div class="inline-flex rounded-lg bg-[#F5F5F7] dark:bg-zinc-900 p-0.5 border border-[#E5E7EB] dark:border-zinc-800 text-xs"><a href="index.html?sort=chronological" class="px-2.5 py-1 rounded-md ${feed.sort === 'chronological' ? 'bg-white dark:bg-zinc-800 font-semibold shadow-sm' : 'text-zinc-500'}">Latest</a><a href="index.html?sort=importance" class="px-2.5 py-1 rounded-md ${feed.sort === 'importance' ? 'bg-white dark:bg-zinc-800 font-semibold shadow-sm' : 'text-zinc-500'}">Priority</a></div></div>${categoryTabs()}<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">${rest.slice(5).map(renderGridCard).join('')}</div>${pagination()}</section>
    </div>`;
  }
  let loadGeneration = 0;
  async function load() {
    const generation = ++loadGeneration;
    feed.loading = true; feed.error = null; render();
    try {
      const [news, sources, health] = await Promise.all([loadNews(query()), fetchJSON('/api/sources').catch(() => ({ sources: [] })), fetchJSON('/api/health').catch(() => null)]);
      if (generation !== loadGeneration) return;
      feed.articles = news.articles; feed.total = news.total || 0; feed.totalPages = Math.max(1, Math.ceil(feed.total / PAGE_SIZE));
      if (feed.page > feed.totalPages) { feed.page = feed.totalPages; return load(); }
      feed.sources = sources.sources || []; state.articles = feed.articles; state.health = health;
      updateFooter(feed.articles.length, feed.sources.length);
    } catch (error) {
      if (generation !== loadGeneration) return;
      feed.error = error.message;
    } finally {
      if (generation === loadGeneration) { feed.loading = false; render(); }
    }
  }
  FC.refreshPage = load;
  window.addEventListener('fincapita:search', (event) => {
    feed.q = event.detail; feed.page = 1;
    const queryString = new URLSearchParams({ ...(feed.q ? { q: feed.q } : {}), ...(feed.category !== 'all' ? { category: feed.category } : {}), ...(feed.ticker !== 'all' ? { ticker: feed.ticker } : {}), ...(feed.sort !== 'chronological' ? { sort: feed.sort } : {}) });
    history.replaceState(null, '', 'index.html' + (queryString.size ? '?' + queryString : '')); load();
  });
  window.addEventListener('fincapita:newsrefresh', load);
  window.addEventListener('fincapita:saved', render);
  load();
})();
