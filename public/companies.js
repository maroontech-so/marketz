(() => {
  const { root, state, ISSUERS, loadNews, renderSkeleton, renderError, pageHeading, escHtml, issuerUrl } = FC;
  let articles = [];
  let loading = true;
  let error = null;
  let query = '';
  let sector = 'all';
  function visible() {
    const term = query.trim().toLowerCase();
    return ISSUERS.filter((issuer) => (sector === 'all' || issuer.sector === sector) && (!term || `${issuer.ticker} ${issuer.name} ${issuer.sector}`.toLowerCase().includes(term)));
  }
  function render() {
    FC.renderPage = render;
    if (loading) { root.innerHTML = renderSkeleton(); return; }
    if (error) { root.innerHTML = renderError(error); return; }
    const sectors = [...new Set(ISSUERS.map((issuer) => issuer.sector))].sort();
    root.innerHTML = `<div class="space-y-8">
      <div class="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-5">${pageHeading('NSE issuer directory', 'Company Intelligence', 'Issuer profiles, sector context and every linked story in the current intelligence archive. Live quotes appear only when a licensed feed is configured.')}<a href="markets.html#equities" class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#0B0B0C] dark:bg-zinc-800 text-white text-xs font-bold self-start xl:self-auto">Open market data <span aria-hidden="true">→</span></a></div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3"><div class="p-4 rounded-xl bg-[#F5F5F7] dark:bg-zinc-900 border border-[#E5E7EB] dark:border-zinc-800"><div class="text-[10px] uppercase tracking-wider text-zinc-500">Directory</div><div class="font-display font-extrabold text-2xl mt-1">${ISSUERS.length}</div><div class="text-xs text-zinc-500">reference issuers</div></div><div class="p-4 rounded-xl bg-[#F5F5F7] dark:bg-zinc-900 border border-[#E5E7EB] dark:border-zinc-800"><div class="text-[10px] uppercase tracking-wider text-zinc-500">Following</div><div class="font-display font-extrabold text-2xl mt-1 text-[#FF4D1C]">${state.watchlist.filter((symbol) => ISSUERS.some((issuer) => issuer.ticker === symbol)).length}</div><div class="text-xs text-zinc-500">local watchlist</div></div><div class="p-4 rounded-xl bg-[#F5F5F7] dark:bg-zinc-900 border border-[#E5E7EB] dark:border-zinc-800"><div class="text-[10px] uppercase tracking-wider text-zinc-500">Coverage</div><div class="font-display font-extrabold text-2xl mt-1">${articles.length}</div><div class="text-xs text-zinc-500">recent linked stories</div></div><div class="p-4 rounded-xl bg-[#F5F5F7] dark:bg-zinc-900 border border-[#E5E7EB] dark:border-zinc-800"><div class="text-[10px] uppercase tracking-wider text-zinc-500">Sectors</div><div class="font-display font-extrabold text-2xl mt-1">${sectors.length}</div><div class="text-xs text-zinc-500">market segments</div></div></div>
      <div class="flex flex-col sm:flex-row gap-3"><label class="relative flex-1"><span class="sr-only">Search companies</span><input id="company-search" type="search" value="${escHtml(query)}" placeholder="Search ticker, company or sector…" oninput="companySearch(this.value)" class="w-full px-4 py-3 rounded-xl bg-white dark:bg-[#12141A] border border-[#E5E7EB] dark:border-zinc-800 text-sm focus:outline-none focus:border-[#FF4D1C]"></label><select onchange="companySector(this.value)" aria-label="Filter by sector" class="px-4 py-3 rounded-xl bg-white dark:bg-[#12141A] border border-[#E5E7EB] dark:border-zinc-800 text-sm"><option value="all">All sectors</option>${sectors.map((name) => `<option value="${escHtml(name)}" ${sector === name ? 'selected' : ''}>${escHtml(name)}</option>`).join('')}</select></div>
      <div class="flex items-center justify-between text-xs text-zinc-500"><span>${visible().length} issuers shown</span><span>Reference directory · not a price feed</span></div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">${visible().map((issuer) => {
        const followed = state.watchlist.includes(issuer.ticker);
        const linked = articles.filter((article) => article.tickers.includes(issuer.ticker));
        const latest = linked[0];
        return `<article class="group p-5 rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] hover:border-[#FF4D1C]/50 hover:shadow-lg transition-all flex flex-col"><div class="flex items-start justify-between gap-3"><a href="${issuerUrl(issuer.ticker)}" class="px-2.5 py-1 rounded-md bg-[#0B0B0C] dark:bg-zinc-800 text-white font-mono text-xs font-bold">NSE:${issuer.ticker}</a><button data-follow="${issuer.ticker}" class="px-2.5 py-1 rounded-md text-xs font-semibold border ${followed ? 'bg-[#FF4D1C] text-white border-[#FF4D1C]' : 'border-zinc-300 dark:border-zinc-700'}">${followed ? 'Following' : '+ Follow'}</button></div><a href="${issuerUrl(issuer.ticker)}"><h2 class="font-display font-bold text-lg mt-4 group-hover:text-[#FF4D1C]">${escHtml(issuer.name)}</h2><div class="text-xs text-zinc-500 mt-1">${escHtml(issuer.sector)}</div></a><div class="mt-5 pt-4 border-t border-[#E5E7EB] dark:border-zinc-800 flex items-center justify-between text-xs"><span class="text-zinc-500">Linked coverage</span><span class="font-mono font-bold">${linked.length} ${linked.length === 1 ? 'story' : 'stories'}</span></div>${latest ? `<a href="${FC.articleUrl(latest.id)}" class="mt-3 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 hover:text-[#FF4D1C]">${escHtml(latest.title)}</a>` : '<p class="mt-3 text-xs text-zinc-400">No recent linked coverage.</p>'}</article>`;
      }).join('')}</div>
    </div>`;
    root.querySelectorAll('[data-follow]').forEach((button) => button.addEventListener('click', () => FC.toggleWatchlist(button.dataset.follow)));
  }
  window.companySearch = (value) => { query = value; render(); document.getElementById('company-search')?.focus(); };
  window.companySector = (value) => { sector = value; render(); };
  FC.refreshPage = async () => {
    loading = true; error = null; render();
    try { articles = (await loadNews({ limit: 100 })).articles; }
    catch (exception) { error = exception.message; }
    loading = false; render();
  };
  window.addEventListener('fincapita:watchlist', render);
  FC.refreshPage();
})();
