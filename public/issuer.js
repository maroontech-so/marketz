(() => {
  const { root, state, ISSUERS, loadNews, pageHeading, escHtml, articleUrl } = FC;
  const ticker = String(new URLSearchParams(location.search).get('ticker') || '').toUpperCase();
  const issuer = ISSUERS.find((item) => item.ticker === ticker);
  let articles = [];
  let error = null;
  const ISSUER_DOMAINS = {
    SCOM: 'safaricom.co.ke', KCB: 'kcbgroup.com', EQTY: 'equitybank.co.ke', COOP: 'coopbank.co.ke',
    EABL: 'eabl.com', KEGN: 'kengen.co.ke', CTUM: 'centum.co.ke', KPLC: 'kplc.co.ke', KQ: 'kenya-airways.com',
    NCBA: 'ncbagroup.com', ABSA: 'absa.co.ke', SCBK: 'sc.com', BAMB: 'bamburicement.com',
    SASN: 'sasini.com', KUKZ: 'kakuzi.com', BAT: 'batkenya.com',
  };
  function fallbackColor(issuer) {
    let hash = 0;
    for (let i = 0; i < issuer.ticker.length; i++) hash = ((hash << 5) - hash + issuer.ticker.charCodeAt(i)) | 0;
    const h = Math.abs(hash) % 360;
    return `linear-gradient(135deg, hsl(${h}, 60%, 45%), hsl(${(h + 40) % 360}, 60%, 45%))`;
  }
  function logoFor(issuer) {
    const domain = ISSUER_DOMAINS[issuer.ticker];
    if (domain) return `https://img.logo.dev/${domain}?token=pk_NElI-AhVS-qP7iOLicx2zg&size=400`;
    return null;
  }
  function render() {
    FC.renderPage = render;
    if (!issuer) { root.innerHTML = `<div class="py-20 text-center"><h3 class="font-display font-bold text-lg">Issuer not found</h3><p class="text-sm text-zinc-500">${escHtml(ticker)} is not in the reference directory.</p><a href="companies.html" class="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-[#FF4D1C] text-white text-xs font-bold hover:bg-[#E03D10]">All companies →</a></div>`; return; }
    if (error) { root.innerHTML = `<div class="py-20 text-center rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 bg-[#F5F5F7] dark:bg-zinc-900/50 space-y-4 max-w-xl mx-auto"><h3 class="font-display font-bold text-lg">Something interrupted the feed</h3><p class="text-sm text-zinc-500">${escHtml(error)}</p><button onclick="FC.refreshPage()" class="px-4 py-2 rounded-lg bg-[#FF4D1C] text-white text-xs font-bold">Try again</button></div>`; return; }
    document.title = `${issuer.name} (${issuer.ticker}) — FinCapita`;
    const followed = state.watchlist.includes(ticker);
    root.innerHTML = `<div class="space-y-8">
      <a href="companies.html" class="inline-flex items-center gap-2 text-xs font-semibold text-zinc-500 hover:text-[#FF4D1C]"><span aria-hidden="true">←</span> All companies</a>
      <section class="relative overflow-hidden rounded-3xl p-0 m-0 w-full min-h-[320px] sm:min-h-[400px]"><div class="absolute inset-0 bg-black/35 rounded-[inherit] pointer-events-none"></div><div class="absolute -right-24 -top-32 w-96 h-96 rounded-full bg-[#FF4D1C]/20 blur-[100px] pointer-events-none"></div><div class="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6 h-full p-6 sm:p-8" style="background-image: ${logoFor(issuer) ? `url('${escHtml(logoFor(issuer))}'), ` : ''}linear-gradient(to bottom, rgba(11,11,12,0.35), rgba(11,11,12,0.55)), ${fallbackColor(issuer)}; background-size: cover; background-position: center; background-repeat: no-repeat;"><div class="flex-1"><span class="inline-flex px-3 py-1 rounded-lg bg-white/90 font-mono text-xs font-bold text-[#111315]">NSE:${escHtml(ticker)}</span><h1 class="font-display font-extrabold text-3xl sm:text-4xl mt-2 text-white">${escHtml(issuer.name)}</h1><p class="text-zinc-200 text-sm mt-2">${escHtml(issuer.sector)} · Issuer intelligence profile</p></div><div class="flex flex-wrap gap-3"><button id="follow-issuer" class="px-4 py-2.5 rounded-xl text-xs font-bold ${followed ? 'bg-[#FF4D1C] text-white' : 'bg-white/10 border border-white/15'}">${followed ? 'Following' : '+ Follow issuer'}</button><a href="markets.html#equities" class="px-4 py-2.5 rounded-xl bg-white text-[#111315] text-xs font-bold">View market board</a></div></div></section>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4"><div class="p-5 rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A]"><div class="text-xs text-zinc-500">Linked stories</div><div class="font-display font-extrabold text-3xl mt-1">${articles.length}</div></div><div class="p-5 rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A]"><div class="text-xs text-zinc-500">Latest coverage</div><div class="font-display font-extrabold text-xl mt-2">${articles[0] ? escHtml(FC.formatDate(articles[0].publishedAt, { day:'2-digit', month:'short', year:'numeric' })) : '—'}</div></div><div class="p-5 rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A]"><div class="text-xs text-zinc-500">Price status</div><div class="font-display font-extrabold text-xl mt-2">Licensed feed</div><div class="text-[11px] text-zinc-500 mt-1">No simulated quotes</div></div></div>
      <section class="space-y-5"><div class="flex items-end justify-between gap-4"><div><span class="text-[10px] font-mono uppercase tracking-wider text-[#FF4D1C]">Coverage stream</span><h2 class="font-display font-extrabold text-2xl mt-1">Latest ${escHtml(ticker)} intelligence</h2></div><span class="text-xs text-zinc-500">${articles.length} articles</span></div>${articles.length ? `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">${articles.map(FC.renderGridCard).join('')}</div>` : `<div class="p-8 text-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-[#F5F5F7] dark:bg-zinc-900/50"><p class="text-sm text-zinc-500">No recent articles are tagged ${escHtml(ticker)}.</p></div>`}</section>
      <aside class="rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 bg-[#F5F5F7] dark:bg-zinc-900 p-5 text-xs text-zinc-500 leading-relaxed">Company profiles and article links are informational only. Verify announcements, financial statements and prices with the NSE and the issuer before making an investment decision.</aside>
    </div>`;
    document.getElementById('follow-issuer')?.addEventListener('click', () => FC.toggleWatchlist(ticker));
  }
  async function loadArticles() {
    try {
      articles = (await loadNews({ ticker, limit: 100 })).articles;
      render();
    } catch (exception) {
      error = exception.message;
      render();
    }
  }
  render();
  loadArticles();
  window.addEventListener('fincapita:watchlist', render);
  window.addEventListener('fincapita:saved', render);
  FC.refreshPage = () => { loadArticles(); };
})();
