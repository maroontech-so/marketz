(() => {
  const { root, state, ISSUERS, loadNews, renderSkeleton, renderError, renderEmpty, escHtml, articleUrl } = FC;
  const ticker = String(new URLSearchParams(location.search).get('ticker') || '').toUpperCase();
  const issuer = ISSUERS.find((item) => item.ticker === ticker);
  let articles = [];
  let loading = true;
  let error = null;
  function render() {
    FC.renderPage = render;
    if (!issuer) { root.innerHTML = renderEmpty('Issuer not found in the reference directory.'); return; }
    if (loading) { root.innerHTML = renderSkeleton(); return; }
    if (error) { root.innerHTML = renderError(error); return; }
    document.title = `${issuer.name} (${issuer.ticker}) — FinCapita`;
    const followed = state.watchlist.includes(ticker);
    root.innerHTML = `<div class="space-y-8">
      <a href="companies.html" class="inline-flex items-center gap-2 text-xs font-semibold text-zinc-500 hover:text-[#FF4D1C]"><span aria-hidden="true">←</span> All companies</a>
      <section class="relative overflow-hidden rounded-3xl bg-[#0B0B0C] text-white p-6 sm:p-9"><div class="absolute -right-20 -top-24 w-80 h-80 rounded-full bg-[#FF4D1C]/20 blur-3xl"></div><div class="relative flex flex-col md:flex-row md:items-end justify-between gap-6"><div><span class="inline-flex px-3 py-1 rounded-lg bg-white/10 font-mono text-xs font-bold">NSE:${escHtml(ticker)}</span><h1 class="font-display font-extrabold text-3xl sm:text-4xl mt-4">${escHtml(issuer.name)}</h1><p class="text-zinc-400 text-sm mt-2">${escHtml(issuer.sector)} · Issuer intelligence profile</p></div><div class="flex flex-wrap gap-3"><button id="follow-issuer" class="px-4 py-2.5 rounded-xl text-xs font-bold ${followed ? 'bg-[#FF4D1C] text-white' : 'bg-white/10 border border-white/15'}">${followed ? 'Following' : '+ Follow issuer'}</button><a href="markets.html#equities" class="px-4 py-2.5 rounded-xl bg-white text-[#111315] text-xs font-bold">View market board</a></div></div></section>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4"><div class="p-5 rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A]"><div class="text-xs text-zinc-500">Linked stories</div><div class="font-display font-extrabold text-3xl mt-1">${articles.length}</div></div><div class="p-5 rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A]"><div class="text-xs text-zinc-500">Latest coverage</div><div class="font-display font-extrabold text-xl mt-2">${articles[0] ? escHtml(FC.formatDate(articles[0].publishedAt, { day:'2-digit', month:'short', year:'numeric' })) : '—'}</div></div><div class="p-5 rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A]"><div class="text-xs text-zinc-500">Price status</div><div class="font-display font-extrabold text-xl mt-2">Licensed feed</div><div class="text-[11px] text-zinc-500 mt-1">No simulated quotes</div></div></div>
      <section class="space-y-5"><div class="flex items-end justify-between gap-4"><div><span class="text-[10px] font-mono uppercase tracking-wider text-[#FF4D1C]">Coverage stream</span><h2 class="font-display font-extrabold text-2xl mt-1">Latest ${escHtml(ticker)} intelligence</h2></div><span class="text-xs text-zinc-500">${articles.length} articles</span></div>${articles.length ? `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">${articles.map(FC.renderGridCard).join('')}</div>` : renderEmpty(`No recent articles are tagged ${ticker}.`)}</section>
      <aside class="rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 bg-[#F5F5F7] dark:bg-zinc-900 p-5 text-xs text-zinc-500 leading-relaxed">Company profiles and article links are informational only. Verify announcements, financial statements and prices with the NSE and the issuer before making an investment decision.</aside>
    </div>`;
    document.getElementById('follow-issuer')?.addEventListener('click', () => FC.toggleWatchlist(ticker));
  }
  FC.refreshPage = async () => {
    loading = true; error = null; render();
    try { articles = (await loadNews({ ticker, limit: 100 })).articles; }
    catch (exception) { error = exception.message; }
    loading = false; render();
  };
  window.addEventListener('fincapita:watchlist', render);
  window.addEventListener('fincapita:saved', render);
  FC.refreshPage();
})();
