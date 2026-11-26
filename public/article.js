(() => {
  const root = document.getElementById('app-workspace');
  const requestedId = new URLSearchParams(location.search).get('id')?.trim();
  const esc = FC.escHtml;
  const safeUrl = FC.safeUrl;
  let article = null;
  let related = [];
  let shareOpen = false;

  const text = value => String(value ?? '');
  const list = value => Array.isArray(value) ? value.map(text).map(item => item.trim()).filter(Boolean) : [];
  const positive = value => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };

  function normalize(raw) {
    const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const base = FC.normalizeArticle(input);
    const status = text(input.fullTextStatus || base.fullTextStatus || 'pending').toLowerCase();
    const originalUrl = safeUrl(input.originalUrl) || safeUrl(input.resolvedUrl) || (status === 'fallback' ? '' : safeUrl(input.sourceUrl));
    return {
      ...base,
      id: text(input.id ?? base.id).trim(),
      title: text(input.title ?? base.title).trim() || 'Untitled',
      sourceName: text(input.sourceName || input.actualSourceName || input.fallbackSourceName || base.sourceName).trim() || 'Source',
      category: text(input.category || base.category || 'equity_markets'),
      categoryLabel: text(base.categoryLabel) || 'Markets',
      publishedAt: text(input.publishedAt || input.collectedAt || base.publishedAt),
      excerpt: text(input.summary ?? input.excerpt ?? base.excerpt).trim(),
      contentHtml: typeof input.contentHtml === 'string' ? input.contentHtml.trim() : '',
      rewrittenHtml: typeof input.rewrittenHtml === 'string' ? input.rewrittenHtml.trim() : '',
      rewriteMethod: text(input.rewriteMethod || base.rewriteMethod).toLowerCase(),
      byline: text(input.byline ?? base.byline).trim(),
      wordCount: Math.round(positive(input.wordCount ?? base.wordCount)),
      readingTimeMinutes: Math.ceil(positive(input.readingTimeMinutes ?? base.readingTimeMinutes)),
      fullTextStatus: status,
      rights: text(input.contentAccess || input.rights || base.rights).toLowerCase(),
      tickers: list(input.tickers ?? base.tickers),
      institutions: list(input.institutions ?? base.institutions),
      imageUrl: FC.secureImageUrl(input.imageUrl) || base.imageUrl || '',
      sourceUrl: safeUrl(input.sourceUrl) || originalUrl,
      originalUrl,
      fallbackUrl: safeUrl(input.fallbackUrl),
      fallbackSourceName: text(input.fallbackSourceName).trim(),
      sources: Array.isArray(input.sources) ? input.sources.map(source => {
        if (typeof source === 'string') return { name: source.trim(), url: '' };
        if (!source || typeof source !== 'object') return null;
        return { name: text(source.name || source.title || source.sourceName).trim(), url: safeUrl(source.url || source.sourceUrl) };
      }).filter(source => source && (source.name || source.url)) : [],
    };
  }

  function externalLink(rawUrl, label, classes = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#FF4D1C] text-white text-xs font-bold hover:bg-[#E03D10] transition-colors') {
    const href = safeUrl(rawUrl);
    return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" class="${classes}">${esc(label)} <span aria-hidden="true">&nearr;</span></a>` : '';
  }

  function hostname(rawUrl) {
    try { return new URL(rawUrl).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  function originalTarget(item) {
    return item.fullTextStatus === 'fallback' ? item.originalUrl : item.originalUrl || item.sourceUrl;
  }

  function originalLink(item) {
    const fallback = item.fullTextStatus === 'fallback';
    const label = fallback ? `Original article · ${hostname(item.originalUrl) || 'publisher'}` : `Original article · ${item.sourceName}`;
    return externalLink(originalTarget(item), label);
  }

  function imageFrame(item, hero = false) {
    const ratio = hero ? 'aspect-video' : 'aspect-[4/3]';
    const radius = hero ? 'rounded-2xl' : 'rounded-xl';
    const fallback = `<div class="absolute inset-0 flex items-end bg-gradient-to-br from-[#0B0B0C] via-[#14161B] to-[#1F242D] p-4"><div><div class="font-mono text-[10px] uppercase tracking-wider text-[#FF4D1C]">${esc(item.categoryLabel)}</div><div class="mt-1 text-sm font-semibold text-white">${esc(item.sourceName)}</div><div class="mt-1 text-[11px] text-zinc-400">Image unavailable</div></div></div>`;
    const classes = `${ratio} relative overflow-hidden ${radius} border border-[#E5E7EB] dark:border-zinc-800 bg-[#F5F5F7] dark:bg-zinc-900`;
    if (!item.imageUrl || !FC.canDisplayArticleImage(item)) return `<div class="${classes}">${fallback}</div>`;
    return `<div data-image-frame class="${classes}">${fallback}<img data-image-fallback src="${esc(item.imageUrl)}" alt="${hero ? esc(item.title) : ''}" loading="${hero ? 'eager' : 'lazy'}" decoding="async" class="absolute inset-0 h-full w-full object-cover"></div>`;
  }

  const noteTones = {
    blue: 'border-blue-200 dark:border-blue-800/60 bg-blue-50/70 dark:bg-blue-950/20 text-blue-950 dark:text-blue-100',
    emerald: 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/20 text-emerald-950 dark:text-emerald-100',
    amber: 'border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/20 text-amber-950 dark:text-amber-100',
    zinc: 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-zinc-800 dark:text-zinc-200',
  };

  function rightsNote(title, message, links, tone = 'zinc', extra = '') {
    return `<aside class="mt-8 rounded-xl border p-4 text-sm ${noteTones[tone]}"><h2 class="font-bold">${esc(title)}</h2><p class="mt-1 leading-relaxed opacity-90">${esc(message)}</p>${extra}${links ? `<div class="mt-3 flex flex-wrap gap-2">${links}</div>` : ''}</aside>`;
  }

  function emptyBody() {
    return '<p class="text-zinc-500 dark:text-zinc-400">No article text or excerpt is available for this item yet.</p>';
  }

  function rightsView(item) {
    const content = item.contentHtml;
    const excerpt = item.excerpt ? `<p>${esc(item.excerpt)}</p>` : '';
    const original = originalLink(item);
    const readOriginal = externalLink(originalTarget(item), `Read the original at ${item.sourceName}`);
    const fullTextPermitted = ['licensed_full_text', 'official_disclosure'].includes(item.rights);
    const restricted = ['paywalled', 'blocked', 'pending', 'excerpt_only', 'metadata_only'].includes(item.fullTextStatus) || ['summary_permitted', 'paywalled', 'blocked', 'metadata_only', 'excerpt_only'].includes(item.rights);
    const extractive = item.rewriteMethod === 'extractive';
    const summaryLabel = item.rewrittenHtml ? (extractive ? 'Extractive summary' : 'AI-generated summary') : 'Summary only';
    const generatedSummary = item.rewrittenHtml || '';
    const attributedSources = item.sources.length ? `<ul class="mt-3 space-y-1.5">${item.sources.map(source => `<li>${source.url ? externalLink(source.url, source.name || hostname(source.url), 'font-medium underline underline-offset-2') : esc(source.name || hostname(source.url))}</li>`).join('')}</ul>` : '';
    let label = summaryLabel;
    let body = generatedSummary || excerpt;
    let title = 'Summary only';
    let message = '';
    let links = readOriginal;
    let tone = 'amber';
    let extra = attributedSources;

    if (item.fullTextStatus === 'fallback') {
      if (!body) body = emptyBody();
      label = summaryLabel;
      title = 'Summary only · Original and alternate sources';
      message = `Full text from ${item.sourceName}, an alternate source, is not reproduced here. Read the original or the attributed alternate coverage for complete reporting.`;
      links = `${original}${externalLink(item.sourceUrl || item.fallbackUrl, `Alternate source at ${item.sourceName}`)}`;
    } else if (restricted) {
      if (!body) body = emptyBody();
      const reason = item.fullTextStatus === 'paywalled' || item.rights === 'paywalled'
        ? `${item.sourceName} places the full article behind a paywall.`
        : item.fullTextStatus === 'blocked' || item.rights === 'blocked'
          ? `${item.sourceName} blocked automated retrieval.`
          : item.fullTextStatus === 'pending'
            ? 'Full text has not been retrieved yet.'
            : item.rights === 'metadata_only' || item.fullTextStatus === 'metadata_only'
              ? 'This item is available as metadata and an excerpt only.'
              : item.rights === 'summary_permitted'
                ? `${item.sourceName} permits summary display only.`
                : item.fullTextStatus === 'excerpt_only'
                  ? 'The publisher provided an excerpt rather than full text.'
                  : 'Full-text reproduction rights are not confirmed for this item.';
      message = `${reason} Read the original for the complete article.`;
      if (item.fullTextStatus === 'pending') label = item.rewrittenHtml ? summaryLabel : 'Excerpt · Retrieval pending';
    } else if (item.fullTextStatus === 'compiled' && fullTextPermitted && content) {
      body = content;
      const count = item.sources.length;
      label = 'Compiled report';
      title = 'Compiled report · Attributed sources';
      message = count ? `Assembled from ${count} attributed ${count === 1 ? 'source' : 'sources'}, not reproduced from a single publisher's full article.` : 'Assembled from attributed source material, not reproduced from a single publisher\'s full article.';
      links = original;
      tone = 'blue';
    } else if (content && item.rights === 'licensed_full_text') {
      body = content;
      label = 'Licensed full text';
      title = 'Full text reproduced under licence';
      message = `Reproduced under licence from ${item.sourceName}. Consult the original source for authoritative updates.`;
      tone = 'emerald';
    } else if (content && item.rights === 'official_disclosure') {
      body = content;
      label = 'Official full text';
      title = 'Official disclosure · Full text';
      message = `Official disclosure from ${item.sourceName}. Consult the original source for the authoritative version and any updates.`;
      tone = 'emerald';
    } else if (item.fullTextStatus === 'synthesized') {
      if (!body) body = emptyBody();
      label = summaryLabel;
      title = 'Generated summary · Not full text';
      message = 'Generated from the headline and attributed feed summary, not reproduced from the publisher\'s full article.';
    } else if (item.rewrittenHtml) {
      label = summaryLabel;
      title = 'Summary only · Not a full reproduction';
      message = `This ${extractive ? 'extractive summary' : 'AI-generated summary'} is not the publisher's full article. Read the original for complete reporting.`;
      body = generatedSummary;
    } else if (content && !fullTextPermitted) {
      if (!body) body = emptyBody();
      label = summaryLabel;
      title = 'Summary only · Full-text rights unconfirmed';
      message = 'Full-text reproduction rights are not confirmed for this item. Read the original for complete reporting.';
    } else if (body) {
      message = `Only the publisher-provided excerpt is available. Read the original at ${item.sourceName} for the complete article.`;
    } else {
      label = 'No text available';
      title = 'No article text available';
      message = 'The feed contains metadata for this item, but no article text or excerpt yet. Use the original-source link when available.';
      body = emptyBody();
      tone = 'zinc';
    }

    return { label, body: `<div class="article-body prose prose-lg dark:prose-invert max-w-none">${body}</div>`, note: rightsNote(title, message, links, tone, extra) };
  }

  function setupOpenGraph(item) {
    const url = safeUrl(location.href);
    const image = item.imageUrl || '/logo.png';
    const title = `${item.title} — FinCapita`;
    const description = item.excerpt || `Kenya capital markets coverage from ${item.sourceName}.`;
    const tags = [
      ['property', 'og:title', title],
      ['property', 'og:description', description],
      ['property', 'og:url', url],
      ['property', 'og:type', 'article'],
      ['property', 'og:image', image],
      ['property', 'og:image:alt', title],
      ['property', 'og:site_name', 'FinCapita'],
      ['name', 'twitter:card', 'summary_large_image'],
      ['name', 'twitter:title', title],
      ['name', 'twitter:description', description],
      ['name', 'twitter:image', image],
    ];
    tags.forEach(([attr, name, content]) => {
      if (!content) return;
      let el = document.querySelector(`meta[${attr}="${name}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    });
  }
  function findRelated(items) {
    const tickers = new Set(article.tickers.map(item => item.toUpperCase()));
    const institutions = new Set(article.institutions.map(item => item.toUpperCase()));
    const seen = new Set([article.id]);
    return items.map(normalize).filter(item => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).map(item => {
      let score = item.category === article.category ? 1 : 0;
      item.tickers.forEach(ticker => { if (tickers.has(ticker.toUpperCase())) score += 2; });
      item.institutions.forEach(institution => { if (institutions.has(institution.toUpperCase())) score += 1; });
      return { item, score };
    }).filter(match => match.score > 0).sort((a, b) => b.score - a.score || (Date.parse(b.item.publishedAt) || 0) - (Date.parse(a.item.publishedAt) || 0)).slice(0, 4).map(match => match.item);
  }

  function relatedCard(item) {
    return `<a href="${esc(safeUrl(FC.articleUrl(item.id)))}" class="group flex gap-3 rounded-xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] p-4 hover:border-[#FF4D1C] transition-colors">${item.imageUrl ? `<div class="w-20 sm:w-24 shrink-0">${imageFrame(item)}</div>` : ''}<div class="min-w-0 flex-1"><div class="text-[10px] text-zinc-500 dark:text-zinc-400">${esc(item.sourceName)} · ${esc(FC.timeAgo(item.publishedAt))}</div><h3 class="mt-1 text-sm font-semibold leading-snug group-hover:text-[#FF4D1C] line-clamp-2">${esc(item.title)}</h3><p class="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 line-clamp-2">${esc(item.excerpt)}</p></div></a>`;
  }

  function shareButtons(item) {
    const url = encodeURIComponent(safeUrl(location.href) || location.href);
    const title = encodeURIComponent(item.title);
    const desc = encodeURIComponent(item.excerpt || `${item.sourceName} · FinCapita`);
    const image = encodeURIComponent(item.imageUrl || '');
    return [
      { label: 'X / Twitter', href: `https://twitter.com/intent/tweet?text=${title}&url=${url}`, color: 'bg-zinc-900 text-white hover:bg-zinc-800' },
      { label: 'WhatsApp', href: `https://wa.me/?text=${title}%20${url}`, color: 'bg-emerald-600 text-white hover:bg-emerald-700' },
      { label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`, color: 'bg-blue-700 text-white hover:bg-blue-800' },
      { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${url}`, color: 'bg-blue-600 text-white hover:bg-blue-700' },
    ].map((s) => `<a href="${s.href}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation(); FC.toggleShare()" class="flex items-center justify-between px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-[#F5F5F7] dark:hover:bg-zinc-800 transition-colors"><span>${esc(s.label)}</span><span class="text-xs opacity-60">→</span></a>`);
  }
  function toggleShare() {
    shareOpen = !shareOpen;
    const overlay = document.getElementById('share-overlay');
    if (overlay) overlay.classList.toggle('hidden');
    const btn = document.querySelector('button[onclick="FC.toggleShare()"]');
    if (btn) btn.setAttribute('aria-expanded', String(shareOpen));
  }
  function copyLink() {
    const url = safeUrl(location.href) || location.href;
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.querySelector('button[onclick="FC.copyLink()"]');
      const original = btn ? btn.textContent : '';
      if (btn) { btn.textContent = 'Copied'; btn.classList.add('text-emerald-600', 'dark:text-emerald-400'); }
      setTimeout(() => { if (btn) { btn.textContent = original; btn.classList.remove('text-emerald-600', 'dark:text-emerald-400'); } }, 1500);
      toggleShare();
    }).catch(() => toggleShare());
  }

  function render() {
    if (!article) return;
    const rights = rightsView(article);
    const saved = FC.isSaved(article.id);
    root.innerHTML = `<div class="max-w-5xl mx-auto">
      <div class="mb-7 flex flex-wrap items-center justify-between gap-3">
        <a href="${esc(safeUrl('index.html'))}" class="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-[#FF4D1C]"><span aria-hidden="true">←</span> Back to feed</a>
        <div class="flex flex-wrap items-center gap-2">${originalLink(article)}<button type="button" data-save-article="${esc(article.id)}" aria-pressed="${saved ? 'true' : 'false'}" class="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-bold ${saved ? 'border-[#FF4D1C] text-[#FF4D1C]' : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-[#FF4D1C]'}"><svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4z"></path></svg>${saved ? 'Saved' : 'Save article'}</button><button type="button" onclick="FC.toggleShare()" aria-expanded="${shareOpen ? 'true' : 'false'}" class="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-bold border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-[#FF4D1C] hover:bg-[#F5F5F7] dark:hover:bg-zinc-800"><svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>Share</button></div>
      </div>
      <article>
        <header class="space-y-4">
          <div class="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400"><span class="font-semibold text-[#FF4D1C]">${esc(article.categoryLabel)}</span><span>·</span><time datetime="${esc(article.publishedAt)}">${esc(FC.timeAgo(article.publishedAt))}</time><span>·</span><span>${esc(article.sourceName)}</span>${article.readingTimeMinutes ? `<span>·</span><span>${article.readingTimeMinutes} min read</span>` : ''}<span class="rounded-full bg-zinc-100 px-2.5 py-1 font-mono text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">${esc(rights.label)}</span></div>
          <h1 class="font-display text-3xl font-extrabold leading-[1.12] tracking-[-0.03em] text-[#111315] dark:text-white sm:text-4xl lg:text-[44px]">${esc(article.title)}</h1>
          ${article.byline ? `<p class="text-sm text-zinc-500 dark:text-zinc-400">By ${esc(article.byline)}</p>` : ''}
          <div class="flex flex-wrap gap-x-5 gap-y-1.5 font-mono text-[11px] text-zinc-500"><span>Published: <strong class="text-[#111315] dark:text-zinc-200">${esc(FC.formatEAT(article.publishedAt))}</strong></span>${article.wordCount ? `<span>${esc(article.wordCount.toLocaleString())} words in source</span>` : ''}</div>
        </header>
        <figure class="mt-8">${imageFrame(article, true)}${article.imageUrl && FC.canDisplayArticleImage(article) ? `<figcaption class="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">Image source: ${esc(article.sourceName)}</figcaption>` : ''}</figure>
        <div class="mt-8">${rights.body}${rights.note}</div>
      </article>
      ${related.length ? `<section class="mt-12 border-t border-[#E5E7EB] pt-7 dark:border-zinc-800"><h2 class="font-display text-xl font-bold tracking-tight">Related coverage <span class="font-mono text-sm font-normal text-zinc-500">(${related.length})</span></h2><div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">${related.map(relatedCard).join('')}</div></section>` : ''}
      <div id="share-overlay" class="fixed inset-0 z-50 hidden ${shareOpen ? 'flex' : ''} items-center justify-center">
        <div onclick="FC.toggleShare()" class="fixed inset-0 bg-black/60 backdrop-blur-sm"></div>
        <div class="relative w-full max-w-md mx-auto p-4 sm:p-6 rounded-2xl border border-[#E5E7EB] dark:border-zinc-800 bg-white dark:bg-[#12141A] shadow-2xl">
          <div class="flex items-center gap-2 mb-5"><div class="w-10 h-10 rounded-xl bg-[#FF4D1C] flex items-center justify-center"><svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg></div><h3 class="font-display font-bold text-lg">Share article</h3></div>
          <p class="text-xs text-zinc-500 dark:text-zinc-400 mb-6">${esc(article.title)}</p>
          <div class="grid grid-cols-2 gap-3">
            ${shareButtons(article).join('')}
          </div>
          <div class="mt-5 pt-4 border-t border-zinc-200 dark:border-zinc-800 flex justify-between items-center"><button onclick="FC.toggleShare()" class="text-xs text-zinc-500 hover:text-[#111315] dark:hover:text-white">Cancel</button><button onclick="FC.copyLink()" class="text-xs font-bold text-[#FF4D1C] hover:underline">Copy link</button></div>
        </div>
      </div>
    </div>`;
  }

  function notice(title, message, retry = false) {
    const href = retry ? safeUrl(location.href) : safeUrl('index.html');
    return `<div class="mx-auto max-w-xl rounded-2xl border border-[#E5E7EB] bg-zinc-50 px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900/50"><h1 class="font-display text-xl font-bold">${esc(title)}</h1><p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">${esc(message)}</p><a href="${esc(href)}" class="mt-5 inline-block rounded-lg bg-[#FF4D1C] px-4 py-2 text-xs font-bold text-white hover:bg-[#E03D10]">${retry ? 'Try again' : 'Back to feed'}</a></div>`;
  }

  async function load() {
    if (!requestedId) {
      article = null;
      related = [];
      root.innerHTML = notice('Article not specified', 'Open an article from the latest intelligence feed.');
      return;
    }
    article = null;
    related = [];
    root.innerHTML = `<div class="mx-auto max-w-5xl">${FC.renderSkeleton()}</div>`;
    try {
      const [data, news] = await Promise.all([
        FC.fetchJSON(`/api/article/${encodeURIComponent(requestedId)}`),
        FC.fetchJSON('/api/news?limit=100').catch(() => ({ articles: [] })),
      ]);
      const raw = data?.article;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('404 Article not found');
      article = normalize(raw);
      if (!article.id) article.id = requestedId;
      document.title = `${article.title} — FinCapita`;
      setupOpenGraph(article);
      related = findRelated(Array.isArray(news?.articles) ? news.articles : []);
    } catch (error) {
      article = null;
      related = [];
      const notFound = /^404\b/.test(text(error?.message));
      root.innerHTML = notFound
        ? notice('Article not found', 'This article may have been removed or the link is no longer available.')
        : notice('Could not load article', 'The article service could not be reached. Check your connection and try again.', true);
      return;
    }
    render();
  }

  root.addEventListener('error', event => {
    if (event.target instanceof HTMLImageElement && event.target.hasAttribute('data-image-fallback')) event.target.remove();
  }, true);
  window.addEventListener('fincapita:saved', () => { if (article) render(); });
  FC.renderPage = render;
  FC.refreshPage = load;
  FC.toggleShare = toggleShare;
  FC.copyLink = copyLink;
  load();
})();
