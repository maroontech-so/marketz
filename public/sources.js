(() => {
  const { root, fetchJSON, renderSkeleton, renderError, pageHeading, escHtml, timeAgo, updateFooter } = FC;
  let sources = [];
  let health = null;
  let loading = true;
  let error = null;
  function render() {
    FC.renderPage = render;
    if (loading) { root.innerHTML = renderSkeleton(); return; }
    if (error) { root.innerHTML = renderError(error); return; }
    const enabled = sources.filter((source) => source.enabled).length;
    const operational = sources.filter((source) => source.enabled && !source.lastError).length;
    root.innerHTML = `<div class="space-y-8"><div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">${pageHeading('Provenance & reliability', 'Source Registry', 'Every story retains its publisher, collection time and reproduction rights. Connector health is shown without implying independent verification of publisher claims.')}<button onclick="refreshNews()" class="px-4 py-2.5 rounded-xl bg-[#FF4D1C] hover:bg-[#E03D10] text-white text-xs font-bold self-start lg:self-auto">Run ingestion sync</button></div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">${[['Registered',sources.length],['Enabled',enabled],['Operational',operational],['Archived articles',health?.articleCount ?? '—']].map(([label,value]) => `<div class="p-5 rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A]"><div class="text-[10px] uppercase tracking-wider text-zinc-500">${label}</div><div class="font-display font-extrabold text-3xl mt-1">${escHtml(value)}</div></div>`).join('')}</div>
      <section class="rounded-3xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] overflow-hidden"><div class="p-5 sm:p-6 border-b border-[#E5E7EB] dark:border-zinc-800"><h2 class="font-display font-bold text-xl">News connectors</h2><p class="text-xs text-zinc-500 mt-1">Official disclosures, licensed material and summary-permitted publications are handled differently.</p></div><div class="hidden md:block overflow-x-auto"><table class="w-full text-left text-xs"><thead><tr class="bg-[#F5F5F7] dark:bg-zinc-900 text-zinc-500"><th class="px-5 py-3.5">Source</th><th class="px-5 py-3.5">Tier</th><th class="px-5 py-3.5">Content handling</th><th class="px-5 py-3.5">Last success</th><th class="px-5 py-3.5 text-right">Status</th></tr></thead><tbody class="divide-y divide-[#E5E7EB] dark:divide-zinc-800">${sources.map(sourceRow).join('')}</tbody></table></div><div class="md:hidden divide-y divide-[#E5E7EB] dark:divide-zinc-800">${sources.map((source) => `<div class="p-5"><div class="flex items-start justify-between gap-3"><div><h3 class="font-bold text-sm">${escHtml(source.name)}</h3><div class="text-[10px] text-zinc-500 mt-1">Tier ${source.tier} · ${rightsLabel(source.rights)}</div></div>${statusBadge(source)}</div>${source.lastError ? `<p class="text-[11px] text-rose-600 mt-3 break-words">${escHtml(source.lastError)}</p>` : `<p class="text-[11px] text-zinc-500 mt-3">${source.lastSuccessAt ? 'Last success ' + escHtml(timeAgo(source.lastSuccessAt)) : 'No successful collection recorded'}</p>`}</div>`).join('')}</div></section>
      <div class="grid md:grid-cols-3 gap-4">${[['Official disclosure','Public regulatory and exchange disclosures are attributed to the issuing institution.'],['Summary permitted','Where full reproduction is not licensed, FinCapita presents verified excerpts or clearly labelled summaries.'],['No silent fabrication','Unavailable market feeds stay unavailable. The interface never turns placeholders into simulated prices.']].map(([title,text]) => `<div class="p-5 rounded-2xl bg-[#F5F5F7] dark:bg-zinc-900 border border-[#E5E7EB] dark:border-zinc-800"><h3 class="font-display font-bold">${title}</h3><p class="text-xs text-zinc-500 leading-relaxed mt-2">${text}</p></div>`).join('')}</div>
    </div>`;
    updateFooter(health?.articleCount || 0, sources.length);
  }
  function rightsLabel(rights) { return ({ official_disclosure:'Official disclosure', licensed_full_text:'Licensed full text', summary_permitted:'Summary only' })[rights] || escHtml(rights || 'Unclassified'); }
  function statusBadge(source) {
    const operational = source.enabled && !source.lastError;
    return `<span class="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold ${!source.enabled ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800' : operational ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'}">${!source.enabled ? 'Disabled' : operational ? 'Operational' : `Failing · ${source.consecutiveFailures || 1}`}</span>`;
  }
  function sourceRow(source) {
    return `<tr class="hover:bg-[#F5F5F7] dark:hover:bg-zinc-900/50"><td class="px-5 py-4"><div class="font-bold">${escHtml(source.name)}</div><div class="text-[10px] text-zinc-500 mt-1 max-w-[240px] truncate">${escHtml(source.feedUrl || 'No public feed URL')}</div></td><td class="px-5 py-4 font-mono">T${source.tier}</td><td class="px-5 py-4 text-zinc-500">${rightsLabel(source.rights)}</td><td class="px-5 py-4 text-zinc-500">${source.lastSuccessAt ? escHtml(timeAgo(source.lastSuccessAt)) : '—'}</td><td class="px-5 py-4 text-right">${statusBadge(source)}</td></tr>`;
  }
  FC.refreshPage = async () => {
    loading = true; error = null; render();
    try { const [sourceData, healthData] = await Promise.all([fetchJSON('/api/sources'), fetchJSON('/api/health').catch(() => null)]); sources = sourceData.sources || []; health = healthData; }
    catch (exception) { error = exception.message; }
    loading = false; render();
  };
  window.addEventListener('fincapita:newsrefresh', FC.refreshPage);
  FC.refreshPage();
})();
