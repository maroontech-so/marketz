(() => {
  const { root, fetchJSON, escHtml, formatDate, formatEAT, ISSUERS, articleUrl, issuerUrl, renderSkeleton, renderError, renderEmpty, pageHeading, showToast } = FC;
  const TYPES = [
    { id: 'dividend', label: 'Dividend declaration', color: 'border-orange-500/20 bg-orange-50 text-orange-700 dark:border-orange-900/30 dark:bg-orange-900/30 dark:text-orange-400' },
    { id: 'book_closure', label: 'Book closure / record date', color: 'border-violet-500/20 bg-violet-50 text-violet-700 dark:border-violet-900/30 dark:bg-violet-900/30 dark:text-violet-400' },
    { id: 'agm', label: 'Annual general meeting', color: 'border-blue-500/20 bg-blue-50 text-blue-700 dark:border-blue-900/30 dark:bg-blue-900/30 dark:text-blue-400' },
    { id: 'earnings', label: 'Earnings announcement', color: 'border-emerald-500/20 bg-emerald-50 text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-900/30 dark:text-emerald-400' },
    { id: 'rights_issue', label: 'Rights issue', color: 'border-indigo-500/20 bg-indigo-50 text-indigo-700 dark:border-indigo-900/30 dark:bg-indigo-900/30 dark:text-indigo-400' },
    { id: 'bond_maturity', label: 'Bond maturity', color: 'border-zinc-500/20 bg-zinc-50 text-zinc-700 dark:border-zinc-900/30 dark:bg-zinc-900/30 dark:text-zinc-300' },
  ];
  const TYPE_CONFIG = Object.fromEntries(TYPES.map((t) => [t.id, t]));
  const view = {
    events: [], loading: true, error: null, refreshedAt: null,
    type: 'all', from: '', to: '', q: '', refreshing: false,
    selectedEvent: null,
  };
  const supportedIssuer = (ticker) => ISSUERS.find((i) => i.ticker.toUpperCase() === String(ticker || '').toUpperCase());
  function escUrl(url) { return escHtml(url); }
  function pill(type) {
    const cfg = TYPE_CONFIG[type];
    const c = cfg ? cfg.color : TYPE_CONFIG.bond_maturity.color;
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${c}">${escHtml(cfg ? cfg.label : type)}</span>`;
  }
  function tickerCell(tickers) {
    if (!tickers?.length) return '<span class="text-xs font-mono text-zinc-400">—</span>';
    return tickers.map((t) => {
      const issuer = supportedIssuer(t);
      const label = escHtml(t);
      return issuer ? `<a href="${escHtml(issuerUrl(issuer.ticker))}" class="font-mono text-xs font-semibold text-[#111315] dark:text-zinc-100 hover:text-[#FF4D1C]">${label}</a>` : `<span class="font-mono text-xs font-semibold text-zinc-500">${label}</span>`;
    }).join('<span class="text-zinc-300 mx-1">·</span>');
  }
  function sourceLink(event) {
    const url = event.sourceUrl;
    const host = url ? (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '';
    return `<a href="${escUrl(url)}" target="_blank" rel="noopener noreferrer" class="text-xs font-semibold text-[#FF4D1C] hover:underline flex items-center gap-1">${escHtml(event.sourceName || host || 'Source')} <span aria-hidden="true">→</span></a>`;
  }
  function formatEventDate(eventDate) {
    const d = new Date(eventDate);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) + ' EAT';
  }
  function formatEventTime(eventDate) {
    const d = new Date(eventDate);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
  }
  function groupEventsByDate(events) {
    const groups = new Map();
    events.forEach((event) => {
      const d = new Date(event.eventDate);
      const key = d.toISOString().slice(0, 10);
      if (!groups.has(key)) groups.set(key, { date: key, events: [] });
      groups.get(key).events.push(event);
    });
    return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  function renderEventCard(event) {
    const cfg = TYPE_CONFIG[event.eventType];
    const isToday = new Date(event.eventDate).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
    return `
      <article class="group relative rounded-xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] p-4 sm:p-5 hover:border-[#FF4D1C]/50 hover:shadow-md transition-all cursor-pointer" data-event-id="${escHtml(event.id)}">
        ${isToday ? '<span class="absolute top-2 left-2 z-10 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#FF4D1C] text-[8px] font-bold text-white uppercase">Today</span>' : ''}
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div>
            <div class="flex items-center gap-2">${pill(event.eventType)}</div>
            <div class="mt-1.5 font-display font-bold text-[#111315] dark:text-white line-clamp-2 text-sm leading-tight">${escHtml(event.title)}</div>
          </div>
          <div class="text-right">
            <div class="font-mono font-bold text-xs tabular-nums">${escHtml(formatEventDate(event.eventDate))}</div>
            <div class="text-[10px] text-zinc-500 mt-0.5 uppercase tracking-wider">${escHtml(cfg ? cfg.label : event.eventType)}</div>
          </div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="px-2.5 py-2 rounded-lg border border-[#F5F5F7] dark:border-zinc-800/50 bg-[#F5F5F7] dark:bg-zinc-900/50">
            <div class="text-[9px] font-mono uppercase text-zinc-500">Issuer</div>
            <div class="mt-0.5 font-mono text-xs text-[#111315] dark:text-zinc-100">${tickerCell(event.tickers)}</div>
          </div>
          <div class="px-2.5 py-2 rounded-lg border border-[#F5F5F7] dark:border-zinc-800/50 bg-[#F5F5F7] dark:bg-zinc-900/50">
            <div class="text-[9px] font-mono uppercase text-zinc-500">Source</div>
            <div class="mt-0.5 text-[10px] text-zinc-600 dark:text-zinc-400">${escHtml(event.sourceName || 'NSE')}</div>
          </div>
          <div class="px-2.5 py-2 rounded-lg border border-[#F5F5F7] dark:border-zinc-800/50 bg-[#F5F5F7] dark:bg-zinc-900/50">
            <div class="text-[9px] font-mono uppercase text-zinc-500">Published</div>
            <div class="mt-0.5 font-mono text-xs text-zinc-600 dark:text-zinc-400">${escHtml(event.publishedAt ? formatDate(event.publishedAt, { day: '2-digit', month: 'short', year: 'numeric' }) : '—')}</div>
          </div>
          <div class="px-2.5 py-2 rounded-lg border border-[#F5F5F7] dark:border-zinc-800/50 bg-[#F5F5F7] dark:bg-zinc-900/50 flex items-center justify-end gap-1.5">
            <span class="text-[9px] font-bold text-[#111315] dark:text-white">Open</span>
            <svg class="w-3 h-3 text-zinc-400 group-hover:text-[#FF4D1C] transition-colors" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </div>
        </div>
        ${event.summary ? `<p class="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">${escHtml(event.summary)}</p>` : ''}
        <button data-event-id="${escHtml(event.id)}" class="absolute top-4 right-4 p-2 rounded-lg border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] text-zinc-400 hover:text-[#FF4D1C] transition-colors" aria-label="View details"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
      </article>
    `;
  }
  function renderEvents() {
    const now = new Date();
    const term = view.q.trim().toLowerCase();
    const filtered = view.events.filter((event) => {
      if (view.type !== 'all' && event.eventType !== view.type) return false;
      if (view.from && new Date(event.eventDate) < new Date(view.from)) return false;
      if (view.to && new Date(event.eventDate) > new Date(view.to + 'T23:59:59')) return false;
      if (term && `${event.title} ${event.summary || ''} ${event.sourceName || ''} ${event.tickers.join(' ')}`.toLowerCase().indexOf(term) < 0) return false;
      return true;
    });
    filtered.sort((a, b) => {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const todayStr = today.toISOString().slice(0, 10);
      const aDate = new Date(a.eventDate).toISOString().slice(0, 10);
      const bDate = new Date(b.eventDate).toISOString().slice(0, 10);
      const aToday = aDate === todayStr;
      const bToday = bDate === todayStr;
      if (aToday && !bToday) return -1;
      if (!aToday && bToday) return 1;
      const aPast = new Date(a.eventDate) < today;
      const bPast = new Date(b.eventDate) < today;
      if (aPast && !bPast) return 1;
      if (!aPast && bPast) return -1;
      return new Date(a.eventDate) - new Date(b.eventDate);
    });
    const counts = {};
    TYPES.forEach((t) => { counts[t.id] = view.events.filter((e) => e.eventType === t.id).length; });
    const totalCount = view.events.length;
    const todayStr = now.toISOString().slice(0, 10);
    const todayCount = view.events.filter((e) => new Date(e.eventDate).toISOString().slice(0, 10) === todayStr).length;
    const upcomingCount = view.events.filter((e) => new Date(e.eventDate) >= now).length;
    const chips = TYPES.map((t) => {
      const active = view.type === t.id;
      return `<button onclick="setCalendarType('${t.id}')" class="flex items-center justify-between w-full px-3 py-2.5 rounded-lg border text-left transition-all ${active ? 'border-[#FF4D1C] bg-[#FF4D1C]/10 text-[#FF4D1C]' : 'border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] text-zinc-600 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'}"><span>${escHtml(TYPE_CONFIG[t.id].label)}</span><span class="inline-flex items-center justify-center w-5 h-2.5 rounded-full ${active ? 'bg-white' : 'bg-zinc-300 dark:bg-zinc-800'} text-[8px] ${counts[t.id] ? '' : 'opacity-0'}">${counts[t.id]}</span></button>`;
    }).join('');
    const stats = [
      { label: 'Total events', value: totalCount },
      { label: 'Today', value: todayCount },
      { label: 'Upcoming', value: upcomingCount },
    ];
    if (view.loading && !view.events.length) return renderSkeleton();
    if (view.error && !view.events.length) return renderError(view.error);
    if (!filtered.length) return renderEmpty('No corporate actions match these filters. Try widening the date range or clearing the search.');
    const groups = groupEventsByDate(filtered);
    return `
      <section class="space-y-8">
        ${pageHeading('Corporate actions calendar', 'NSE corporate actions', 'Dividend declarations, book closures, AGMs, earnings announcements, rights issues and bond maturities for Nairobi Securities Exchange issuers. Data from attributed market coverage and provider sources. All dates East Africa Time (EAT).')}
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-2">
          ${stats.map((s) => `
            <div class="rounded-xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] p-4 sm:p-5">
              <div class="text-[10px] font-mono uppercase text-zinc-500 mb-2">${escHtml(s.label)}</div>
              <div class="font-display font-bold text-2xl sm:text-3xl text-[#111315] dark:text-white">${escHtml(s.value)}</div>
            </div>
          `).join('')}
        </div>
        <div class="rounded-xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] p-4 sm:p-5 shadow-sm">
          <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-[10px] font-mono uppercase text-zinc-500">Filter by type</span>
              <button onclick="resetCalendarFilters()" class="text-[10px] text-[#FF4D1C] font-semibold hover:underline">Reset</button>
            </div>
            <div class="flex flex-wrap gap-1.5">${chips}</div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label class="block text-[10px] font-mono uppercase text-zinc-500 mb-1.5">From date</label>
              <input id="cal-from" type="date" onchange="setCalendarFrom(this.value)" class="w-full px-3 py-2.5 rounded-lg bg-[#F5F5F7] dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs focus:outline-none focus:border-[#FF4D1C]">
            </div>
            <div>
              <label class="block text-[10px] font-mono uppercase text-zinc-500 mb-1.5">To date</label>
              <input id="cal-to" type="date" onchange="setCalendarTo(this.value)" class="w-full px-3 py-2.5 rounded-lg bg-[#F5F5F7] dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs focus:outline-none focus:border-[#FF4D1C]">
            </div>
            <div class="flex items-end">
              <label class="block text-[10px] font-mono uppercase text-zinc-500 mb-1.5">Search</label>
              <input id="cal-q" type="search" oninput="handleCalendarSearch(this.value)" placeholder="Issuer, title, source…" class="w-full px-3 py-2.5 rounded-lg bg-[#F5F5F7] dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs focus:outline-none focus:border-[#FF4D1C]">
            </div>
          </div>
        </div>
        <div class="flex items-center justify-between gap-3 mb-3">
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] font-mono text-zinc-500">${filtered.length}</span>
            <span class="text-xs text-zinc-400">events</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-zinc-500">Updated</span>
            <span class="text-xs font-mono text-[#111315] dark:text-zinc-100">${view.refreshedAt ? escHtml(formatEAT(view.refreshedAt)) : 'live'}</span>
            <button onclick="refreshCalendar(true)" class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] text-[10px] font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-[#F5F5F7] dark:hover:bg-zinc-800 transition-colors"><svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v6h6M20 20v-6h-6M20 8A8 8 0 0 0 5.1 6.1M4 16a8 8 0 0 0 14.9 1.9"/></svg></button>
          </div>
        </div>
        <div class="space-y-2">
          ${groups.map((group) => `
            <div>
              <h3 class="text-[10px] font-mono uppercase tracking-wider text-zinc-500 px-3 mb-2 border-b border-[#E5E7EB] dark:border-zinc-800">${escHtml(new Date(group.date).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }))}</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                ${group.events.map((event) => renderEventCard(event)).join('')}
              </div>
            </div>
          `).join('')}
        </div>
        <p class="mt-2 text-[10px] text-zinc-500">Events are derived from attributed market coverage and provider sources. Confirm dates with the issuer or the NSE before making investment decisions.</p>
      </section>
    `;
  }
  function renderUpcoming(events) {
    const start = new Date();
    const end = new Date(Date.now() + 7 * 86400000);
    const upcoming = events.filter((e) => { const d = new Date(e.eventDate); return d >= start && d <= end; }).sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate)).slice(0, 6);
    if (!upcoming.length) return '<p class="text-xs text-zinc-500">No events in the next 7 days.</p>';
    return upcoming.map((e) => `<div class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-[#E5E7EB] dark:border-zinc-800 bg-[#F5F5F7] dark:bg-zinc-900/40 text-xs"><div><div class="font-semibold text-[#111315] dark:text-white truncate max-w-[150px]">${escHtml(e.title)}</div><div class="text-[10px] text-zinc-500 mt-0.5">${escHtml(e.tickers.join(', ') || '—')}</div></div><div class="text-right"><div class="font-mono font-bold text-xs">${escHtml(new Date(e.eventDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }))}</div><div class="text-[9px] text-zinc-500 uppercase">${escHtml(TYPE_CONFIG[e.eventType] ? TYPE_CONFIG[e.eventType].label : e.eventType)}</div></div></div>`).join('');
  }
  function render() {
    FC.renderPage = render;
    root.innerHTML = renderEvents();
    root.querySelectorAll('[data-event-id]').forEach((el) => {
      el.addEventListener('click', (e) => {
        // Don't open detail if clicking the detail button itself (it's inside the card)
        if (e.target.closest('[aria-label="View details"]')) return;
        const id = el.getAttribute('data-event-id');
        const event = view.events.find((e) => e.id === id);
        if (event) openCalendarEvent(event);
      });
    });
    root.querySelectorAll('[aria-label="View details"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-event-id');
        const event = view.events.find((e) => e.id === id);
        if (event) openCalendarEvent(event);
      });
    });
  }
  function loadCalendar() {
    const embedded = window.__CALENDAR_EVENTS__;
    if (Array.isArray(embedded)) {
      view.events = embedded;
      view.refreshedAt = new Date().toISOString();
      view.loading = false;
      view.error = null;
      render();
      return;
    }
    view.loading = true;
    view.error = null;
    render();
    fetchJSON('/api/calendar')
      .then((data) => {
        view.events = data.events || [];
        view.refreshedAt = data.generatedAt;
        view.loading = false;
        view.error = null;
        render();
      })
      .catch((err) => {
        view.loading = false;
        view.error = err.message;
        render();
      });
  }
  async function refreshCalendar(manual = false) {
    if (view.refreshing) return;
    view.refreshing = true;
    try {
      await loadCalendar();
      if (manual) showToast('Calendar refreshed');
    } catch (err) {
      if (manual) showToast(`Refresh failed: ${err.message}`);
    } finally {
      view.refreshing = false;
    }
  }
  function openCalendarEvent(event) {
    view.selectedEvent = event;
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm';
    modal.innerHTML = `
      <div class="absolute top-4 right-4 z-20"><button onclick="closeCalendarEvent()" class="p-2 rounded-full bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-200 hover:bg-[#FF4D1C] hover:text-white transition-colors"><svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button></div>
      <div class="w-full max-w-2xl rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] shadow-2xl overflow-hidden">
        <div class="p-6 sm:p-8 flex items-start justify-between gap-4">
          <div class="flex items-center gap-2">${pill(event.eventType)}</div>
          <div class="text-right hidden sm:block"><div class="font-mono font-bold text-xs tabular-nums">${escHtml(formatEventDate(event.eventDate))}</div><div class="text-[10px] text-zinc-500">${escHtml(formatEventTime(event.eventDate))}</div></div>
        </div>
        <div class="p-6 sm:p-8">
          <h2 class="font-display font-bold text-xl sm:text-2xl text-[#111315] dark:text-white mb-3 leading-tight">${escHtml(event.title)}</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
            <div>
              <div class="text-[10px] font-mono uppercase text-zinc-500 mb-1">Date</div>
              <div class="font-mono text-xs tabular-nums text-[#111315] dark:text-zinc-100">${escHtml(formatEventDate(event.eventDate))} · ${escHtml(formatEventTime(event.eventDate))}</div>
            </div>
            <div>
              <div class="text-[10px] font-mono uppercase text-zinc-500 mb-1">Issuer</div>
              <div class="font-mono text-xs text-[#111315] dark:text-zinc-100">${tickerCell(event.tickers)}</div>
            </div>
            <div>
              <div class="text-[10px] font-mono uppercase text-zinc-500 mb-1">Source</div>
              <div class="font-mono text-xs text-[#111315] dark:text-zinc-100">${escHtml(event.sourceName || 'NSE')}</div>
            </div>
            <div>
              <div class="text-[10px] font-mono uppercase text-zinc-500 mb-1">Published</div>
              <div class="font-mono text-xs text-zinc-600 dark:text-zinc-400">${escHtml(event.publishedAt ? formatDate(event.publishedAt, { day: '2-digit', month: 'short', year: 'numeric' }) : '—')}</div>
            </div>
          </div>
          ${event.summary ? `<div class="mb-6"><div class="text-[10px] font-mono uppercase text-zinc-500 mb-1">Details</div><p class="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">${escHtml(event.summary)}</p></div>` : ''}
          <div class="flex items-center justify-between gap-3 pt-6 border-t border-[#E5E7EB] dark:border-zinc-800">
            ${event.sourceUrl ? `<a href="${escUrl(event.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#FF4D1C] text-white text-xs font-bold hover:bg-[#E03D10] transition-colors">View original <span aria-hidden="true">→</span></a>` : ''}
            <button onclick="closeCalendarEvent()" class="px-3 py-2 rounded-lg border border-[#E5E7EB] dark:border-zinc-800 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-[#F5F5F7] dark:hover:bg-zinc-800">Close</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeCalendarEvent(); });
  }
  function closeCalendarEvent() {
    view.selectedEvent = null;
    const modal = document.querySelector('.fixed.inset-0.z-50.flex.items-center.justify-center');
    if (modal) modal.remove();
  }
  window.setCalendarType = (type) => { view.type = type; render(); };
  window.setCalendarFrom = (value) => { view.from = value; render(); };
  window.setCalendarTo = (value) => { view.to = value; render(); };
  window.handleCalendarSearch = (value) => { view.q = value; render(); };
  window.resetCalendarFilters = () => { view.type = 'all'; view.from = ''; view.to = ''; view.q = ''; const cf = document.getElementById('cal-from'); const ct = document.getElementById('cal-to'); const cq = document.getElementById('cal-q'); if (cf) cf.value = ''; if (ct) ct.value = ''; if (cq) cq.value = ''; render(); };
  window.refreshCalendar = refreshCalendar;
  window.openCalendarEvent = openCalendarEvent;
  window.closeCalendarEvent = closeCalendarEvent;
  document.getElementById('cal-from')?.addEventListener('change', (e) => setCalendarFrom(e.target.value));
  document.getElementById('cal-to')?.addEventListener('change', (e) => setCalendarTo(e.target.value));
  loadCalendar();
  window.addEventListener('fincapita:theme', render);
})();
