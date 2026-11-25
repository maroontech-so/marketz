(() => {
  const { root, INSTITUTIONS, loadNews, renderSkeleton, renderError, pageHeading, escHtml, articleUrl } = FC;
  let articles = [];
  let loading = true;
  let error = null;
  let institutionCounts = {};
  function providedTotal(code) {
    const raw = institutionCounts[code] ?? institutionCounts[code.toLowerCase()];
    if (raw === null || raw === undefined) return null;
    const value = typeof raw === 'object' ? raw.total ?? raw.count ?? raw.articleCount : raw;
    const count = Number(value);
    return Number.isInteger(count) && count >= 0 ? count : null;
  }
  function scrollToHash() {
    if (!location.hash) return;
    let id = '';
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
  }
  function render() {
    FC.renderPage = render;
    if (loading) { root.innerHTML = renderSkeleton(); return; }
    if (error) { root.innerHTML = renderError(error); return; }
    root.innerHTML = `<div class="space-y-8">${pageHeading('Regulation & market infrastructure', 'Kenya’s Capital Markets Institutions', 'Follow the mandates, disclosures and enforcement activity of the institutions that shape the market.')}
      <div class="rounded-2xl overflow-hidden bg-gradient-to-r from-[#0B0B0C] to-[#20242C] text-white p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-5"><div><div class="text-[10px] font-mono uppercase tracking-wider text-[#FF4D1C]">Institutional map</div><h2 class="font-display font-extrabold text-2xl mt-1">From policy to settlement</h2><p class="text-zinc-400 text-xs mt-2 max-w-xl">CBK manages monetary policy and government debt; CMA regulates; NSE operates the securities market; CDSC clears and settles.</p></div><div class="font-display font-extrabold text-5xl text-white/10">05</div></div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">${INSTITUTIONS.map((institution) => {
        const linked = articles.filter((article) => article.institutions.includes(institution.code));
        const total = providedTotal(institution.code);
        const countLabel = total !== null ? `${total} ${total === 1 ? 'story' : 'stories'}` : linked.length ? `${linked.length} recent ${linked.length === 1 ? 'story' : 'stories'} shown` : 'No recent stories shown';
        return `<article id="institution-${escHtml(institution.code)}" class="rounded-2xl scroll-mt-44 border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] overflow-hidden"><div class="p-6 space-y-5"><div class="flex items-center justify-between gap-3"><span class="px-3 py-1.5 rounded-lg bg-[#0B0B0C] dark:bg-zinc-800 text-white font-mono text-xs font-bold">${institution.code}</span><a href="${escHtml(FC.safeUrl(institution.website))}" target="_blank" rel="noopener noreferrer" class="text-xs font-semibold text-[#FF4D1C]">Official site ↗</a></div><div><h2 class="font-display font-bold text-xl">${escHtml(institution.name)}</h2><div class="text-xs font-medium text-emerald-600 dark:text-emerald-400 mt-1">${escHtml(institution.role)}</div></div><div class="flex items-center justify-between pt-4 border-t border-[#E5E7EB] dark:border-zinc-800 text-xs"><span class="text-zinc-500">${total !== null ? 'Linked coverage' : 'Recent coverage'}</span><span class="font-mono font-bold">${countLabel}</span></div></div>${linked.length ? `<div class="border-t border-[#E5E7EB] dark:border-zinc-800 divide-y divide-[#E5E7EB] dark:divide-zinc-800">${linked.slice(0,3).map((article) => `<a href="${articleUrl(article.id)}" class="block p-4 hover:bg-[#F5F5F7] dark:hover:bg-zinc-900"><div class="text-[10px] text-zinc-500">${escHtml(FC.formatDate(article.publishedAt,{day:'2-digit',month:'short'}))} · ${escHtml(article.sourceName)}</div><h3 class="text-sm font-semibold mt-1 line-clamp-2">${escHtml(article.title)}</h3></a>`).join('')}</div>` : `<div class="px-6 py-4 border-t border-[#E5E7EB] dark:border-zinc-800 text-xs text-zinc-500">${total ? 'No matching stories in the latest 100 fetched.' : 'No recent tagged coverage.'}</div>`}</article>`;
      }).join('')}</div>
    </div>`;
  }
  FC.refreshPage = async () => {
    loading = true; error = null; render();
    try {
      const data = await loadNews({ limit: 100 });
      articles = data.articles;
      institutionCounts = {
        ...(data.counts?.institutions || {}),
        ...(data.institutionCounts || {}),
        ...(data.institutionTotals || {}),
      };
    } catch (exception) { error = exception.message; }
    loading = false; render();
    scrollToHash();
  };
  window.addEventListener('hashchange', scrollToHash);
  FC.refreshPage();
})();
