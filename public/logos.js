(() => {
  const { root, escHtml, pageHeading, renderError, renderEmpty, showToast } = FC;
  let results = [];
  let loading = false;
  let query = '';
  let selected = null;

  function render() {
    FC.renderPage = render;
    if (loading) {
      root.innerHTML = renderSkeleton ? renderSkeleton() : '<div class="py-20 text-center">Loading…</div>';
      return;
    }
    const filtered = results.filter((r) => !query || `${r.name} ${r.domain}`.toLowerCase().includes(query.toLowerCase()));
    root.innerHTML = `
      <section class="space-y-8">
        ${pageHeading('Corporate logos', 'Company logo lookup', 'Search for companies and download their official logos via Clearbit and logo.dev. Useful for issuer profiles, presentations, and reference materials.')}
        <div class="rounded-xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] p-6 sm:p-8 shadow-sm">
          <div class="flex flex-col sm:flex-row gap-3 mb-6">
            <label class="relative flex-1"><span class="sr-only">Search companies</span><input id="logo-search" type="search" value="${escHtml(query)}" placeholder="Search company name or domain…" oninput="logoSearch(this.value)" class="w-full px-4 py-3 rounded-xl bg-[#F5F5F7] dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm focus:outline-none focus:border-[#FF4D1C]"></label>
            <button onclick="handleLogoSearch()" class="px-5 py-3 rounded-xl bg-[#FF4D1C] text-white text-sm font-bold hover:bg-[#E03D10] transition-colors">Search</button>
          </div>
          <p class="text-xs text-zinc-500 mb-4">Powered by Clearbit autocomplete + logo.dev. Download logos for offline use.</p>
        </div>
        ${selected ? renderSelected(selected) : ''}
        ${results.length === 0 && !query ? renderEmpty('No results yet. Search for a company to see its logo.') : ''}
        ${filtered.length > 0 ? `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">${filtered.map((r) => renderLogoCard(r)).join('')}</div>` : query && results.length > 0 ? renderEmpty('No companies match your search. Try another term.') : ''}
        ${results.length > 0 && !query ? `<p class="text-xs text-zinc-500">${results.length} companies available. Use the search above to filter.</p>` : ''}
      </section>
    `;
    root.querySelectorAll('[data-select]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const domain = btn.dataset.domain;
        const r = results.find((x) => x.domain === domain);
        if (r) { selected = r; render(); }
      });
    });
    root.querySelectorAll('[data-download]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const domain = btn.dataset.domain;
        const r = results.find((x) => x.domain === domain);
        if (!r) return;
        try {
          const res = await fetch(`/api/download?url=${encodeURIComponent(r.logo)}&name=${encodeURIComponent(r.name)}`);
          if (res.ok) {
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `${r.name.replace(/[^a-z0-9]/gi, '_')}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
            showToast(`Downloaded ${r.name} logo`);
          } else {
            showToast('Download failed');
          }
        } catch {
          showToast('Download failed');
        }
      });
    });
    root.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const domain = btn.dataset.domain;
        const r = results.find((x) => x.domain === domain);
        if (!r) return;
        navigator.clipboard.writeText(r.logo).then(() => showToast('Logo URL copied'));
      });
    });
  }

  function renderLogoCard(r) {
    const isSelected = selected && selected.domain === r.domain;
    return `
      <article class="group rounded-xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] p-4 hover:border-[#FF4D1C]/50 hover:shadow-md transition-all cursor-pointer" data-select data-domain="${escHtml(r.domain)}">
        <div class="flex flex-col items-center gap-4 mb-4">
          <div class="w-20 h-20 rounded-xl border border-[#F5F5F7] dark:border-zinc-800/50 bg-[#F5F5F7] dark:bg-zinc-900/50 flex items-center justify-center overflow-hidden">
            <img src="${escHtml(r.logo)}" alt="${escHtml(r.name)}" class="max-w-full max-h-full object-contain" onerror="this.style.display='none'; this.parentElement.innerHTML='<span class=\\'text-zinc-400 text-xs\\'>No logo</span>'">
          </div>
          <div class="text-center">
            <h3 class="font-display font-bold text-sm text-[#111315] dark:text-white line-clamp-1">${escHtml(r.name)}</h3>
            <div class="text-[10px] font-mono text-zinc-500 truncate max-w-[140px]">${escHtml(r.domain)}</div>
          </div>
        </div>
        <div class="flex items-center justify-between gap-2 pt-3 border-t border-[#F5F5F7] dark:border-zinc-800/50">
          <button data-download data-domain="${escHtml(r.domain)}" class="px-3 py-1.5 rounded-lg border border-[#E5E7EB] dark:border-zinc-800 bg-[#F5F5F7] dark:bg-zinc-900/50 text-[10px] font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-[#FF4D1C] hover:text-white hover:border-[#FF4D1C] transition-colors">Download</button>
          <button data-copy data-domain="${escHtml(r.domain)}" class="px-2 py-1.5 rounded-lg border border-[#E5E7EB] dark:border-zinc-800 text-[10px] font-semibold text-zinc-400 hover:text-[#FF4D1C] transition-colors" title="Copy logo URL">↗</button>
        </div>
        ${isSelected ? '<div class="mt-2 px-3 py-1 rounded-md bg-[#FF4D1C]/10 text-[9px] font-bold text-[#FF4D1C]">Selected</div>' : ''}
      </article>
    `;
  }

  function renderSelected(r) {
    return `
      <div class="rounded-xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] p-6 sm:p-8 shadow-sm">
        <div class="flex flex-col sm:flex-row gap-6 items-start sm:items-center">
          <div class="w-32 h-32 sm:w-48 sm:h-48 rounded-2xl border border-[#F5F5F7] dark:border-zinc-800/50 bg-[#F5F5F7] dark:bg-zinc-900/50 flex items-center justify-center overflow-hidden">
            <img src="${escHtml(r.logo)}" alt="${escHtml(r.name)}" class="max-w-full max-h-full object-contain" onerror="this.style.display='none'; this.parentElement.innerHTML='<span class=\\'text-zinc-400 text-sm\\'>No logo</span>'">
          </div>
          <div class="flex-1">
            <h2 class="font-display font-bold text-2xl sm:text-3xl text-[#111315] dark:text-white mb-1">${escHtml(r.name)}</h2>
            <div class="text-[11px] font-mono text-zinc-500 mb-4">${escHtml(r.domain)}</div>
            <div class="flex gap-3">
              <a href="${escHtml(r.logo)}" target="_blank" rel="noopener noreferrer" class="px-4 py-2.5 rounded-lg bg-[#FF4D1C] text-white text-xs font-bold hover:bg-[#E03D10] transition-colors">Open logo image</a>
              <button data-download data-domain="${escHtml(r.domain)}" class="px-4 py-2.5 rounded-lg border border-[#E5E7EB] dark:border-zinc-800 bg-[#F5F5F7] dark:bg-zinc-900/50 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-[#FF4D1C] hover:text-white transition-colors">Download PNG</button>
              <button data-copy data-domain="${escHtml(r.domain)}" class="px-4 py-2.5 rounded-lg border border-[#E5E7EB] dark:border-zinc-800 bg-[#F5F5F7] dark:bg-zinc-900/50 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-[#FF4D1C] hover:text-white transition-colors">Copy URL</button>
              <button onclick="logoClearSelection()" class="px-4 py-2.5 rounded-lg border border-[#E5E7EB] dark:border-zinc-800 bg-[#F5F5F7] dark:bg-zinc-900/50 text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors">Clear</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async function handleLogoSearch() {
    const input = document.getElementById('logo-search');
    const value = input ? input.value.trim() : '';
    if (!value) return;
    query = value;
    loading = true;
    render();
    try {
      const res = await fetch(`/api/logos?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error('Lookup failed');
      results = await res.json();
    } catch (err) {
      results = [];
      showToast(err.message || 'Logo lookup failed');
    } finally {
      loading = false;
      selected = null;
      render();
    }
  }

  window.logoSearch = (value) => { query = value; render(); };
  window.handleLogoSearch = handleLogoSearch;
  window.logoClearSelection = () => { selected = null; render(); };

  document.getElementById('logo-search')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleLogoSearch(); });

  render();
})();
