(() => {
  const { root, state, ISSUERS, INSTITUTIONS, fetchJSON, normalizeArticle, renderSkeleton, renderError, renderEmpty, pageHeading, escHtml } = FC;
let savedArticles = [];
let loading = true;
let error = null;
let editingAlert = null;
let hydrateGeneration = 0;
  function startAlertEdit(id) {
    const alert = state.alerts.find((item) => item.id === id);
    if (!alert) return;
    editingAlert = { id, target: String(alert.target || ''), condition: String(alert.condition || '') };
    render();
    requestAnimationFrame(() => root.querySelector('[data-alert-edit] input')?.focus());
  }
  function saveAlertEdit(form) {
    const data = new FormData(form);
    const target = String(data.get('target') || '').trim();
    const condition = String(data.get('condition') || '').trim();
    if (!target || !condition) { FC.showToast('Target and condition are required'); return; }
    const alert = state.alerts.find((item) => item.id === editingAlert?.id);
    if (!alert) return;
    alert.target = target;
    alert.condition = condition;
    editingAlert = null;
    FC.saveState();
    window.dispatchEvent(new CustomEvent('fincapita:alerts'));
    FC.showToast('Local watch rule updated');
  }
  function deleteAlert(id) {
    const alert = state.alerts.find((item) => item.id === id);
    if (!alert || !window.confirm(`Delete the local watch rule for ${alert.target}?`)) return;
    state.alerts = state.alerts.filter((item) => item.id !== id);
    if (editingAlert?.id === id) editingAlert = null;
    FC.saveState();
    window.dispatchEvent(new CustomEvent('fincapita:alerts'));
    FC.showToast('Local watch rule deleted');
  }
  function render() {
    FC.renderPage = render;
    if (loading) { root.innerHTML = renderSkeleton(); return; }
    if (error) { root.innerHTML = renderError(error); return; }
    const missing = state.savedIds.length - savedArticles.length;
    root.innerHTML = `<div class="space-y-8">${pageHeading('Your workspace', 'Saved Stories & Market Watch', 'A local reading library and watch rules. Stored in this browser; no push or email notifications are sent.')}
      <div class="grid grid-cols-3 gap-3"><div class="p-4 sm:p-5 rounded-2xl bg-[#0B0B0C] text-white"><div class="text-[10px] uppercase tracking-wider text-zinc-400">Saved</div><div class="font-display font-extrabold text-3xl mt-1">${state.savedIds.length}</div></div><div class="p-4 sm:p-5 rounded-2xl bg-[#F5F5F7] dark:bg-zinc-900 border border-[#E5E7EB] dark:border-zinc-800"><div class="text-[10px] uppercase tracking-wider text-zinc-500">Following</div><div class="font-display font-extrabold text-3xl mt-1 text-[#FF4D1C]">${state.watchlist.length}</div></div><div class="p-4 sm:p-5 rounded-2xl bg-[#F5F5F7] dark:bg-zinc-900 border border-[#E5E7EB] dark:border-zinc-800"><div class="text-[10px] uppercase tracking-wider text-zinc-500">Watch rules</div><div class="font-display font-extrabold text-3xl mt-1">${state.alerts.filter((alert) => alert.enabled).length}</div></div></div>
      <section class="rounded-3xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] p-6 space-y-4"><div class="flex flex-wrap items-center justify-between gap-3"><div><h2 class="font-display font-bold text-xl">Followed issuers & institutions</h2><p class="text-xs text-zinc-500 mt-1">Quick access to the names you track.</p></div><div class="flex flex-wrap gap-4"><a href="companies.html" class="text-xs font-semibold text-[#FF4D1C]">Browse companies →</a></div></div><div class="flex flex-wrap gap-2">${state.watchlist.length ? state.watchlist.map((symbol) => { const issuer = ISSUERS.find((item) => item.ticker === symbol); const href = issuer ? FC.issuerUrl(symbol) : ''; const content = href ? `<a href="${escHtml(href)}" class="font-mono font-bold hover:text-[#FF4D1C]">${escHtml(symbol)}</a>` : `<span class="font-mono font-bold">${escHtml(symbol)}</span>`; return `<span class="inline-flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-lg bg-[#F5F5F7] dark:bg-zinc-800 text-xs">${content}<button data-unfollow="${escHtml(symbol)}" class="w-5 h-5 rounded text-zinc-400 hover:text-rose-600" aria-label="Unfollow ${escHtml(symbol)}">✕</button></span>`; }).join('') : '<p class="text-sm text-zinc-500">You are not following any names yet.</p>'}</div></section>
      <section class="rounded-3xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] overflow-hidden"><div class="p-6 flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E7EB] dark:border-zinc-800"><div><h2 class="font-display font-bold text-xl">Local watch rules</h2><p class="text-xs text-zinc-500 mt-1">Saved preferences for your research workflow, not a notification service.</p></div><button onclick="addAlertRule()" class="px-3.5 py-2 rounded-lg bg-[#FF4D1C] text-white text-xs font-bold">+ Add rule</button></div><div class="divide-y divide-[#E5E7EB] dark:divide-zinc-800">${state.alerts.length ? state.alerts.map((alert) => {
    if (editingAlert?.id === alert.id) return `<form data-alert-edit="${escHtml(alert.id)}" class="p-4 sm:p-5 space-y-3"><div class="grid grid-cols-1 sm:grid-cols-2 gap-3"><label class="text-[10px] uppercase tracking-wider text-zinc-500">Target<input name="target" required maxlength="120" value="${escHtml(editingAlert.target)}" class="mt-1 w-full min-w-0 px-3 py-2 rounded-lg bg-[#F5F5F7] dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs"></label><label class="text-[10px] uppercase tracking-wider text-zinc-500">Condition<input name="condition" required maxlength="240" value="${escHtml(editingAlert.condition)}" class="mt-1 w-full min-w-0 px-3 py-2 rounded-lg bg-[#F5F5F7] dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs"></label></div><div class="text-[11px] text-zinc-500">${escHtml(alert.channel)}</div><div class="flex flex-wrap gap-2"><button type="submit" class="px-3 py-1.5 rounded-md bg-[#FF4D1C] text-white text-xs font-bold">Save changes</button><button type="button" data-cancel-alert="${escHtml(alert.id)}" class="px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 text-xs font-semibold">Cancel</button></div></form>`;
    return `<div class="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div class="min-w-0"><div class="text-xs"><span class="font-mono font-bold text-[#FF4D1C]">${escHtml(alert.target)}</span><span class="font-semibold sm:ml-2 block sm:inline mt-1">${escHtml(alert.condition)}</span></div><div class="text-[11px] text-zinc-500 mt-1">${escHtml(alert.channel)}</div></div><div class="flex flex-wrap items-center gap-2 self-start sm:self-auto"><button type="button" data-alert="${escHtml(alert.id)}" class="px-3 py-1.5 rounded-md text-xs font-semibold ${alert.enabled ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'}">${alert.enabled ? 'Active locally' : 'Paused'}</button><button type="button" data-edit-alert="${escHtml(alert.id)}" class="px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:border-[#FF4D1C]">Edit</button><button type="button" data-delete-alert="${escHtml(alert.id)}" class="px-3 py-1.5 rounded-md text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30" aria-label="Delete watch rule for ${escHtml(alert.target)}">Delete</button></div></div>`;
  }).join('') : '<p class="p-6 text-sm text-zinc-500">No local watch rules. Add a rule to keep a research reminder in this browser.</p>'}</div></section>
      <section class="space-y-5"><div class="flex flex-wrap items-end justify-between gap-3"><div><span class="text-[10px] font-mono uppercase tracking-wider text-[#FF4D1C]">Reading library</span><h2 class="font-display font-extrabold text-2xl mt-1">Saved stories</h2></div><span class="text-xs text-zinc-500">${savedArticles.length} available${missing > 0 ? ` · ${missing} unavailable` : ''}</span></div>${savedArticles.length ? `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">${savedArticles.map(FC.renderGridCard).join('')}</div>` : renderEmpty('Your saved library is empty. Use “+ Save” on any story to keep it here.')}</section>
    </div>`;
    root.querySelectorAll('[data-unfollow]').forEach((button) => button.addEventListener('click', () => FC.toggleWatchlist(button.dataset.unfollow)));
    root.querySelectorAll('[data-alert]').forEach((button) => button.addEventListener('click', () => window.toggleAlert(button.dataset.alert)));
    root.querySelectorAll('[data-edit-alert]').forEach((button) => button.addEventListener('click', () => startAlertEdit(button.dataset.editAlert)));
    root.querySelectorAll('[data-delete-alert]').forEach((button) => button.addEventListener('click', () => deleteAlert(button.dataset.deleteAlert)));
    root.querySelectorAll('[data-cancel-alert]').forEach((button) => button.addEventListener('click', () => { editingAlert = null; render(); }));
    root.querySelectorAll('[data-alert-edit]').forEach((form) => form.addEventListener('submit', (event) => { event.preventDefault(); saveAlertEdit(form); }));
  }
  async function hydrate() {
    const generation = ++hydrateGeneration;
    const savedIds = [...state.savedIds];
    const savedIdSet = new Set(savedIds);
    const results = await Promise.allSettled(savedIds.map(async (id) => {
      const data = await fetchJSON('/api/article/' + encodeURIComponent(id));
      return data.article ? normalizeArticle(data.article) : null;
    }));
    if (generation !== hydrateGeneration) return false;
    savedArticles = results.filter((result) => result.status === 'fulfilled' && result.value && savedIdSet.has(String(result.value.id))).map((result) => result.value);
    return true;
  }
  FC.refreshPage = async () => {
    const generation = hydrateGeneration + 1;
    loading = true; error = null; render();
    try { await hydrate(); }
    catch (exception) { if (generation !== hydrateGeneration) return; error = exception.message; }
    if (generation === hydrateGeneration) { loading = false; render(); }
  };
  window.addEventListener('fincapita:saved', () => {
    const savedIdSet = new Set(state.savedIds.map(String));
    savedArticles = savedArticles.filter((item) => savedIdSet.has(String(item.id)));
    loading = false; error = null; render();
    hydrate().then((applied) => { if (applied) render(); });
  });
  window.addEventListener('fincapita:watchlist', render);
  window.addEventListener('fincapita:alerts', render);
  FC.refreshPage();
})();
