(() => {
  const { root, state, ISSUERS, loadNews, pageHeading, escHtml, issuerUrl } = FC;
  let articles = [];
  let error = null;
  let query = '';
  let sector = 'all';
  let loaded = false;
  const logoCache = new Map();

  const ISSUER_DOMAINS = {
    SCOM: 'safaricom.co.ke',
    KCB: 'kcbgroup.com',
    EQTY: 'equitybank.co.ke',
    COOP: 'coopbank.co.ke',
    EABL: 'eabl.com',
    KEGN: 'kengen.co.ke',
    CTUM: 'centum.co.ke',
    KPLC: 'kplc.co.ke',
    KQ: 'kenya-airways.com',
    NCBA: 'ncbagroup.com',
    ABSA: 'absa.co.ke',
    SCBK: 'sc.com',
    BAMB: 'bamburicement.com',
    SASN: 'sasini.com',
    KUKZ: 'kakuzi.com',
    BAT: 'batkenya.com',
  };

  function logoFor(issuer) {
    if (logoCache.has(issuer.ticker)) return logoCache.get(issuer.ticker);
    const domain = ISSUER_DOMAINS[issuer.ticker];
    if (domain) {
      const logo = `https://img.logo.dev/${domain}?token=pk_NElI-AhVS-qP7iOLicx2zg&size=400`;
      logoCache.set(issuer.ticker, logo);
      return logo;
    }
    return null;
  }
  function fallbackColor(issuer) {
    let hash = 0;
    for (let i = 0; i < issuer.ticker.length; i++) hash = ((hash << 5) - hash + issuer.ticker.charCodeAt(i)) | 0;
    const h = Math.abs(hash) % 360;
    return `linear-gradient(135deg, hsl(${h}, 60%, 45%), hsl(${(h + 40) % 360}, 60%, 45%))`;
  }
  function visible() {
    const term = query.trim().toLowerCase();
    return ISSUERS.filter((issuer) => (sector === 'all' || issuer.sector === sector) && (!term || `${issuer.ticker} ${issuer.name} ${issuer.sector}`.toLowerCase().includes(term)));
  }
  function renderCard(issuer) {
    const followed = state.watchlist.includes(issuer.ticker);
    const linked = articles.filter((article) => article.tickers.includes(issuer.ticker));
    const latest = linked[0];
    const logo = logoFor(issuer);
    const backdrop = logo
      ? `style="background-image: url('${escHtml(logo)}'), linear-gradient(to bottom, rgba(11,11,12,0.35), rgba(11,11,12,0.55)), ${fallbackColor(issuer)}; background-size: cover; background-position: center;"`
      : `style="background-image: ${fallbackColor(issuer)};"`;
    return `
      <article class="group relative rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] hover:border-[#FF4D1C]/50 hover:shadow-xl transition-all overflow-hidden" ${backdrop}>
        <div class="absolute inset-0 bg-black/40 dark:bg-black/60 rounded-2xl transition-opacity group-hover:bg-black/20 dark:group-hover:bg-black/40 pointer-events-none"></div>
        <div class="relative z-10 p-5">
          <table class="w-full" role="presentation">
            <tr>
              <td class="w-1/3 align-top"><a href="${issuerUrl(issuer.ticker)}" class="px-2.5 py-1 rounded-md bg-white/90 dark:bg-zinc-900/90 text-white font-mono text-xs font-bold backdrop-blur-sm">NSE:${issuer.ticker}</a></td>
              <td class="w-1/3 align-middle text-center"><a href="${issuerUrl(issuer.ticker)}"><h2 class="font-display font-bold text-lg sm:text-xl mt-2 text-white group-hover:text-[#FF4D1C]">${escHtml(issuer.name)}</h2><div class="text-xs text-zinc-200 mt-1 backdrop-blur-sm">${escHtml(issuer.sector)}</div></a></td>
              <td class="w-1/3 align-top text-right"><button data-follow="${issuer.ticker}" class="px-2.5 py-1 rounded-md text-xs font-semibold border ${followed ? 'bg-[#FF4D1C] text-white border-[#FF4D1C]' : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 backdrop-blur-sm'}">${followed ? 'Following' : '+ Follow'}</button></td>
            </tr>
            <tr>
              <td colspan="3" class="pt-4 border-t border-white/10"><div class="flex items-center justify-between text-xs"><span class="text-zinc-400">Linked coverage</span><span class="font-mono font-bold text-zinc-200">${linked.length} ${linked.length === 1 ? 'story' : 'stories'}</span></div>${latest ? `<a href="${FC.articleUrl(latest.id)}" class="mt-3 block text-xs text-zinc-300 dark:text-zinc-400 line-clamp-2 hover:text-[#FF4D1C]">${escHtml(latest.title)}</a>` : '<p class="mt-3 text-xs text-zinc-500 dark:text-zinc-400">No recent linked coverage.</p>'}</td>
            </tr>
          </table>
        </div>
      </article>
    `;
  }
  function render() {
    FC.renderPage = render;
    if (error) {
      root.innerHTML = `<div class="py-20 text-center rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 bg-[#F5F5F7] dark:bg-zinc-900/50 space-y-4 max-w-xl mx-auto"><h3 class="font-display font-bold text-lg">Something interrupted the feed</h3><p class="text-sm text-zinc-500">${escHtml(error)}</p><button onclick="FC.refreshPage()" class="px-4 py-2 rounded-lg bg-[#FF4D1C] text-white text-xs font-bold">Try again</button></div>`;
      return;
    }
    const sectors = [...new Set(ISSUERS.map((issuer) => issuer.sector))].sort();
    const cards = visible().map(renderCard).join('');
    root.innerHTML = `<div class="space-y-8">
      <div class="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-5">${pageHeading('NSE issuer directory', 'Company Intelligence', 'Issuer profiles, sector context and every linked story in the current intelligence archive. Each card carries its brand logo backdrop. Live quotes appear only when a licensed feed is configured.')}<a href="markets.html#equities" class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#0B0B0C] dark:bg-zinc-800 text-white text-xs font-bold self-start xl:self-auto">Open market data <span aria-hidden="true">→</span></a></div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3"><div class="p-4 rounded-xl bg-[#F5F5F7] dark:bg-zinc-900 border border-[#E5E7EB] dark:border-zinc-800"><div class="text-[10px] uppercase tracking-wider text-zinc-500">Directory</div><div class="font-display font-extrabold text-2xl mt-1">${ISSUERS.length}</div><div class="text-xs text-zinc-500">reference issuers</div></div><div class="p-4 rounded-xl bg-[#F5F5F7] dark:bg-zinc-900 border border-[#E5E7EB] dark:border-zinc-800"><div class="text-[10px] uppercase tracking-wider text-zinc-500">Following</div><div class="font-display font-extrabold text-2xl mt-1 text-[#FF4D1C]">${state.watchlist.filter((symbol) => ISSUERS.some((issuer) => issuer.ticker === symbol)).length}</div><div class="text-xs text-zinc-500">local watchlist</div></div><div class="p-4 rounded-xl bg-[#F5F5F7] dark:bg-zinc-900 border border-[#E5E7EB] dark:border-zinc-800"><div class="text-[10px] uppercase tracking-wider text-zinc-500">Coverage</div><div class="font-display font-extrabold text-2xl mt-1">${articles.length}</div><div class="text-xs text-zinc-500">recent linked stories</div></div><div class="p-4 rounded-xl bg-[#F5F5F7] dark:bg-zinc-900 border border-[#E5E7EB] dark:border-zinc-800"><div class="text-[10px] uppercase tracking-wider text-zinc-500">Sectors</div><div class="font-display font-extrabold text-2xl mt-1">${sectors.length}</div><div class="text-xs text-zinc-500">market segments</div></div></div>
      <div class="flex flex-col sm:flex-row gap-3"><label class="relative flex-1"><span class="sr-only">Search companies</span><input id="company-search" type="search" value="${escHtml(query)}" placeholder="Search ticker, company or sector…" oninput="companySearch(this.value)" class="w-full px-4 py-3 rounded-xl bg-white dark:bg-[#12141A] border border-[#E5E7EB] dark:border-zinc-800 text-sm focus:outline-none focus:border-[#FF4D1C]"></label><select onchange="companySector(this.value)" aria-label="Filter by sector" class="px-4 py-3 rounded-xl bg-white dark:bg-[#12141A] border border-[#E5E7EB] dark:border-zinc-800 text-sm"><option value="all">All sectors</option>${sectors.map((name) => `<option value="${escHtml(name)}" ${sector === name ? 'selected' : ''}>${escHtml(name)}</option>`).join('')}</select></div>
      <div class="flex items-center justify-between text-xs text-zinc-500"><span>${visible().length} issuers shown</span><span>Reference directory · not a price feed</span></div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">${cards}</div>
    </div>`;
    root.querySelectorAll('[data-follow]').forEach((button) => button.addEventListener('click', () => FC.toggleWatchlist(button.dataset.follow)));
  }
  window.companySearch = (value) => { query = value; render(); document.getElementById('company-search')?.focus(); };
  window.companySector = (value) => { sector = value; render(); };
  async function loadArticles() {
    try {
      articles = (await loadNews({ limit: 100 })).articles;
      loaded = true;
      render();
    } catch (exception) {
      error = exception.message;
      render();
    }
  }
  async function fetchIssuerLogos() {
    const concurrency = 4;
    const queue = [...ISSUERS];
    const run = () => {
      const issuer = queue.shift();
      if (!issuer) return Promise.resolve();
      if (logoFor(issuer)) return run();
      return fetch(`/api/logos?q=${encodeURIComponent(issuer.name)}`)
        .then(async (r) => {
          if (!r.ok) return null;
          const data = await r.json();
          const best = data.find((d) => d.domain && /\.ke$/i.test(d.domain)) || data[0];
          if (best && best.logo) { logoCache.set(issuer.ticker, best.logo); }
        })
        .catch(() => null)
        .then(run);
    };
    await Promise.all(Array.from({ length: concurrency }).map(run));
    render();
  }
  render();
  loadArticles();
  fetchIssuerLogos();
  window.addEventListener('fincapita:watchlist', render);
  FC.refreshPage = () => { loadArticles(); fetchIssuerLogos(); };
})();
