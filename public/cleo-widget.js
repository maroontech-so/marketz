(function() {
  'use strict';

  const CLEO_API_BASE = '';
  let isOpen = false;
  let isMinimized = false;
  let messageHistory = [];
  let isTyping = false;
  let sessionId = 'cleo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);

  const CATEGORY_LABELS = {
    equity_markets: 'Equities',
    corporate_developments: 'Corporate',
    fixed_income: 'Fixed Income',
    regulation_policy: 'Regulation',
    private_markets: 'Private Markets',
  };

  const QUICK_ACTIONS = [
    { label: '📈 Market Trends (30d)', action: 'trends', params: { days: 30 } },
    { label: '🏦 CBK & Monetary Policy', action: 'institution', params: { code: 'CBK' } },
    { label: '📊 NSE Announcements', action: 'institution', params: { code: 'NSE' } },
    { label: '💰 T-Bill Auction Results', action: 'trends', params: { days: 14, category: 'fixed_income' } },
    { label: '📋 CMA Regulatory Updates', action: 'institution', params: { code: 'CMA' } },
    { label: '🏢 Top NSE Companies', action: 'companies', params: {} },
  ];

  const COMPANY_TICKERS = ['SCOM', 'KCB', 'EQTY', 'COOP', 'EABL', 'NCBA', 'ABSA', 'SCBK', 'KEGN', 'BAMB'];

  function createStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* Cleo FAB */
      #cleo-fab {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9999;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: linear-gradient(135deg, #FF4D1C 0%, #E03D10 100%);
        box-shadow: 0 4px 20px rgba(255, 77, 28, 0.4), 0 2px 6px rgba(0,0,0,0.15);
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s;
        animation: cleo-pulse 3s ease-in-out infinite;
      }
      #cleo-fab:hover {
        transform: scale(1.08);
        box-shadow: 0 6px 28px rgba(255, 77, 28, 0.5), 0 4px 12px rgba(0,0,0,0.2);
      }
      #cleo-fab:active { transform: scale(0.95); }
      #cleo-fab.cleo-open { transform: rotate(45deg); }
      @keyframes cleo-pulse {
        0%, 100% { box-shadow: 0 4px 20px rgba(255, 77, 28, 0.4), 0 2px 6px rgba(0,0,0,0.15); }
        50% { box-shadow: 0 4px 20px rgba(255, 77, 28, 0.6), 0 2px 6px rgba(0,0,0,0.15), 0 0 0 8px rgba(255, 77, 28, 0.1); }
      }
      #cleo-fab svg { width: 26px; height: 26px; color: white; transition: transform 0.2s; }
      #cleo-fab.cleo-open svg { transform: rotate(-45deg); }

      /* Cleo Chat Window */
      #cleo-chat {
        position: fixed;
        bottom: 96px;
        right: 24px;
        z-index: 9998;
        width: 420px;
        max-width: calc(100vw - 48px);
        height: 580px;
        max-height: calc(100vh - 120px);
        background: white;
        border-radius: 20px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.1);
        border: 1px solid #E5E7EB;
        display: none;
        flex-direction: column;
        overflow: hidden;
        transform-origin: bottom right;
        animation: cleo-slide-in 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .dark #cleo-chat { background: #12141A; border-color: #27272A; }
      @keyframes cleo-slide-in {
        from { opacity: 0; transform: scale(0.95) translateY(20px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      #cleo-chat.cleo-minimized { height: 64px; }

      /* Header */
      #cleo-header {
        height: 64px;
        padding: 0 16px;
        background: linear-gradient(135deg, #FF4D1C 0%, #E03D10 100%);
        color: white;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
      }
      #cleo-header-info { display: flex; align-items: center; gap: 12px; }
      #cleo-avatar {
        width: 36px; height: 36px; border-radius: 50%;
        background: rgba(255,255,255,0.2);
        display: flex; align-items: center; justify-content: center;
        font-weight: 700; font-size: 14px;
      }
      #cleo-title { display: flex; flex-direction: column; }
      #cleo-name { font-weight: 700; font-size: 15px; line-height: 1.2; }
      #cleo-status { font-size: 11px; opacity: 0.85; display: flex; align-items: center; gap: 6px; }
      #cleo-status-dot { width: 6px; height: 6px; border-radius: 50%; background: #10B981; }
      #cleo-controls { display: flex; gap: 6px; }
      .cleo-btn {
        width: 32px; height: 32px; border-radius: 10px;
        background: rgba(255,255,255,0.15); border: none; color: white;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; transition: background 0.15s;
      }
      .cleo-btn:hover { background: rgba(255,255,255,0.25); }
      .cleo-btn:active { background: rgba(255,255,255,0.35); }
      .cleo-btn svg { width: 18px; height: 18px; }

      /* Messages Area */
      #cleo-messages {
        flex: 1; overflow-y: auto; padding: 16px;
        display: flex; flex-direction: column; gap: 14px;
        background: #F5F5F7;
      }
      .dark #cleo-messages { background: #0C0D10; }

      /* Message Bubbles */
      .cleo-msg { max-width: 85%; animation: cleo-msg-in 0.25s ease-out; }
      @keyframes cleo-msg-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      .cleo-msg.user { align-self: flex-end; }
      .cleo-msg.assistant { align-self: flex-start; }
      .cleo-bubble {
        padding: 12px 16px; border-radius: 18px;
        font-size: 14px; line-height: 1.55;
        position: relative;
      }
      .cleo-msg.user .cleo-bubble {
        background: #FF4D1C; color: white;
        border-bottom-right-radius: 4px;
      }
      .cleo-msg.assistant .cleo-bubble {
        background: white; color: #111315;
        border: 1px solid #E5E7EB; border-bottom-left-radius: 4px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      }
      .dark .cleo-msg.assistant .cleo-bubble {
        background: #1C1E23; color: #F3F4F6; border-color: #27272A;
      }
      .cleo-msg-time { font-size: 10px; opacity: 0.6; margin-top: 6px; text-align: right; }
      .cleo-msg.assistant .cleo-msg-time { text-align: left; }

      /* Sources */
      .cleo-sources { margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(0,0,0,0.08); }
      .dark .cleo-sources { border-top-color: rgba(255,255,255,0.1); }
      .cleo-sources-label { font-size: 11px; font-weight: 600; color: #6B7280; margin-bottom: 6px; }
      .cleo-source-item {
        display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px;
        background: rgba(255,77,28,0.06); border-radius: 10px; margin-bottom: 6px;
        cursor: pointer; transition: background 0.15s; font-size: 12px;
      }
      .dark .cleo-source-item { background: rgba(255,77,28,0.12); }
      .cleo-source-item:hover { background: rgba(255,77,28,0.12); }
      .dark .cleo-source-item:hover { background: rgba(255,77,28,0.2); }
      .cleo-source-icon { width: 20px; height: 20px; flex-shrink: 0; color: #FF4D1C; }
      .cleo-source-info { flex: 1; min-width: 0; }
      .cleo-source-title { font-weight: 600; color: #111315; line-clamp: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dark .cleo-source-title { color: #F3F4F6; }
      .cleo-source-meta { font-size: 10px; color: #6B7280; display: flex; gap: 8px; margin-top: 2px; }
      .cleo-source-score { font-weight: 600; color: #FF4D1C; }

      /* Typing Indicator */
      .cleo-typing { display: flex; align-items: center; gap: 4px; padding: 8px 12px; }
      .cleo-typing-dot { width: 6px; height: 6px; border-radius: 50%; background: #FF4D1C; animation: cleo-typing 1.4s ease-in-out infinite; }
      .cleo-typing-dot:nth-child(2) { animation-delay: 0.2s; }
      .cleo-typing-dot:nth-child(3) { animation-delay: 0.4s; }
      @keyframes cleo-typing { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-4px); } }

      /* Quick Actions */
      #cleo-quick-actions { padding: 0 16px 16px; display: flex; flex-wrap: wrap; gap: 8px; }
      .cleo-quick-btn {
        padding: 8px 14px; border-radius: 20px; font-size: 12px; font-weight: 500;
        background: white; border: 1px solid #E5E7EB; color: #374151;
        cursor: pointer; transition: all 0.15s; white-space: nowrap;
      }
      .dark .cleo-quick-btn { background: #1C1E23; border-color: #27272A; color: #E5E7EB; }
      .cleo-quick-btn:hover { background: #FF4D1C; border-color: #FF4D1C; color: white; }
      .cleo-quick-btn:active { transform: scale(0.98); }

      /* Input Area */
      #cleo-input-area {
        padding: 12px 16px; border-top: 1px solid #E5E7EB; flex-shrink: 0;
        background: white;
      }
      .dark #cleo-input-area { background: #12141A; border-top-color: #27272A; }
      #cleo-input-wrapper { display: flex; gap: 8px; align-items: flex-end; }
      #cleo-input {
        flex: 1; min-height: 44px; max-height: 140px; padding: 10px 14px;
        border-radius: 22px; border: 1px solid #E5E7EB;
        background: #F5F5F7; color: #111315; font-size: 14px; line-height: 1.5;
        resize: none; outline: none; font-family: inherit;
      }
      .dark #cleo-input { background: #1C1E23; border-color: #27272A; color: #F3F4F6; }
      #cleo-input:focus { border-color: #FF4D1C; box-shadow: 0 0 0 3px rgba(255,77,28,0.15); }
      #cleo-send {
        width: 44px; height: 44px; border-radius: 50%;
        background: #FF4D1C; border: none; color: white;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; transition: background 0.15s, transform 0.1s; flex-shrink: 0;
      }
      #cleo-send:hover { background: #E03D10; }
      #cleo-send:active { transform: scale(0.95); }
      #cleo-send:disabled { background: #D1D5DB; cursor: not-allowed; }
      .dark #cleo-send:disabled { background: #4B5563; }
      #cleo-send svg { width: 20px; height: 20px; }

      /* Welcome Screen */
      #cleo-welcome { padding: 24px 16px; text-align: center; }
      #cleo-welcome-icon { width: 64px; height: 64px; border-radius: 50%; background: linear-gradient(135deg, #FF4D1C, #E03D10); margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; }
      #cleo-welcome h3 { font-size: 18px; font-weight: 700; color: #111315; margin-bottom: 6px; }
      .dark #cleo-welcome h3 { color: #F3F4F6; }
      #cleo-welcome p { font-size: 13px; color: #6B7280; line-height: 1.5; margin-bottom: 20px; }

      /* Mobile Responsive */
      @media (max-width: 480px) {
        #cleo-fab { bottom: 16px; right: 16px; }
        #cleo-chat { bottom: 88px; right: 16px; left: 16px; width: auto; max-width: none; height: 60vh; max-height: 60vh; border-radius: 16px 16px 0 0; }
        #cleo-chat.cleo-minimized { height: 56px; }
      }

      /* Scrollbar */
      #cleo-messages::-webkit-scrollbar { width: 4px; }
      #cleo-messages::-webkit-scrollbar-track { background: transparent; }
      #cleo-messages::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 2px; }
      .dark #cleo-messages::-webkit-scrollbar-thumb { background: #4B5563; }
    `;
    document.head.appendChild(style);
  }

  function createFAB() {
    const fab = document.createElement('button');
    fab.id = 'cleo-fab';
    fab.setAttribute('aria-label', 'Open Cleo AI Assistant');
    fab.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    `;
    fab.addEventListener('click', toggleChat);
    document.body.appendChild(fab);
  }

  function createChatWindow() {
    const chat = document.createElement('div');
    chat.id = 'cleo-chat';
    chat.setAttribute('role', 'dialog');
    chat.setAttribute('aria-label', 'Cleo AI Assistant');
    chat.innerHTML = `
      <header id="cleo-header">
        <div id="cleo-header-info">
          <div id="cleo-avatar">C</div>
          <div id="cleo-title">
            <span id="cleo-name">Cleo</span>
            <span id="cleo-status"><span id="cleo-status-dot"></span>Ready to help</span>
          </div>
        </div>
        <div id="cleo-controls">
          <button class="cleo-btn" id="cleo-minimize" aria-label="Minimize" title="Minimize">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </button>
          <button class="cleo-btn" id="cleo-close" aria-label="Close" title="Close">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </header>
      <div id="cleo-messages" role="log" aria-live="polite"></div>
      <div id="cleo-quick-actions" role="list"></div>
      <div id="cleo-input-area">
        <div id="cleo-input-wrapper">
          <textarea id="cleo-input" placeholder="Ask about markets, companies, trends..." rows="1" aria-label="Your question"></textarea>
          <button id="cleo-send" aria-label="Send" disabled>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(chat);
    bindChatEvents();
    renderWelcome();
    renderQuickActions();
  }

  function bindChatEvents() {
    document.getElementById('cleo-close').addEventListener('click', closeChat);
    document.getElementById('cleo-minimize').addEventListener('click', toggleMinimize);
    document.getElementById('cleo-send').addEventListener('click', sendMessage);
    const input = document.getElementById('cleo-input');
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
      document.getElementById('cleo-send').disabled = !input.value.trim() || isTyping;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (input.value.trim() && !isTyping) sendMessage();
      }
    });
  }

  function toggleChat() {
    const fab = document.getElementById('cleo-fab');
    const chat = document.getElementById('cleo-chat');
    isOpen = !isOpen;
    if (isOpen) {
      chat.style.display = 'flex';
      fab.classList.add('cleo-open');
      setTimeout(() => document.getElementById('cleo-input').focus(), 100);
    } else {
      chat.style.display = 'none';
      fab.classList.remove('cleo-open');
    }
  }

  function closeChat() {
    isOpen = false;
    document.getElementById('cleo-chat').style.display = 'none';
    document.getElementById('cleo-fab').classList.remove('cleo-open');
  }

  function toggleMinimize() {
    const chat = document.getElementById('cleo-chat');
    isMinimized = !isMinimized;
    chat.classList.toggle('cleo-minimized', isMinimized);
    const btn = document.getElementById('cleo-minimize');
    btn.innerHTML = isMinimized
      ? '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7" /></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>';
  }

  function renderWelcome() {
    const container = document.getElementById('cleo-messages');
    container.innerHTML = `
      <div id="cleo-welcome" class="cleo-msg assistant">
        <div class="cleo-bubble">
          <div id="cleo-welcome-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94A12.06 12.06 0 009.594 3.94l-1.58 1.58c2.332 1.485 4.272 3.43 5.547 5.547l1.58-1.58zM20.406 20.06c-.453-.23-1.134-.73-1.58-1.58a12.06 12.06 0 002.273 1.067c.453.23.73 1.134 1.58 1.58a12.06 12.06 0 01-2.273-1.067zM13.5 10.5a3 3 0 11-6 0 3 3 0 016 0zm-4.5 0a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </div>
          <h3>Hi, I'm Cleo</h3>
          <p>Your Kenya capital markets analyst. Ask me about trends, companies, auctions, regulations, or anything in the news.</p>
        </div>
      </div>
    `;
  }

  function renderQuickActions() {
    const container = document.getElementById('cleo-quick-actions');
    container.innerHTML = QUICK_ACTIONS.map((action, i) =>
      `<button class="cleo-quick-btn" data-action="${action.action}" data-params='${JSON.stringify(action.params)}' role="listitem">${action.label}</button>`
    ).join('');
    container.querySelectorAll('.cleo-quick-btn').forEach(btn => {
      btn.addEventListener('click', () => handleQuickAction(btn.dataset.action, JSON.parse(btn.dataset.params)));
    });
  }

  function handleQuickAction(action, params) {
    const input = document.getElementById('cleo-input');
    let question = '';
    switch (action) {
      case 'trends':
        question = `What are the key market trends in Kenya over the last ${params.days || 30} days${params.category ? ' in ' + params.category : ''}?`;
        break;
      case 'institution':
        question = `What are the recent actions and announcements from ${params.code}?`;
        break;
      case 'companies':
        question = `Which NSE-listed companies have been most active in the news recently?`;
        break;
    }
    input.value = question;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    document.getElementById('cleo-send').disabled = false;
    sendMessage();
  }

  async function sendMessage() {
    const input = document.getElementById('cleo-input');
    const question = input.value.trim();
    if (!question || isTyping) return;

    isTyping = true;
    input.value = '';
    input.style.height = 'auto';
    document.getElementById('cleo-send').disabled = true;

    addMessage(question, 'user');
    showTyping();

    try {
      const response = await fetch('/api/cleo/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, options: { topK: 8 } }),
      });

      hideTyping();

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      addMessage(data.answer, 'assistant', data.sources);
    } catch (err) {
      hideTyping();
      addMessage(`Sorry, I couldn't process that. ${err.message}`, 'assistant', []);
    } finally {
      isTyping = false;
      document.getElementById('cleo-send').disabled = !input.value.trim();
    }
  }

  function addMessage(text, role, sources = []) {
    const container = document.getElementById('cleo-messages');
    const welcome = document.getElementById('cleo-welcome');
    if (welcome) welcome.remove();

    const msg = document.createElement('div');
    msg.className = `cleo-msg ${role}`;
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    let sourcesHtml = '';
    if (role === 'assistant' && sources.length > 0) {
      sourcesHtml = `
        <div class="cleo-sources">
          <div class="cleo-sources-label">Sources (${sources.length})</div>
          ${sources.map(s => `
            <a href="${s.url}" target="_blank" rel="noopener noreferrer" class="cleo-source-item">
              <svg class="cleo-source-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg>
              <div class="cleo-source-info">
                <div class="cleo-source-title">${escapeHtml(s.title)}</div>
                <div class="cleo-source-meta">
                  <span>${s.source}</span>
                  <span>${CATEGORY_LABELS[s.category] || s.category}</span>
                  <span class="cleo-source-score">${s.relevanceScore}% match</span>
                </div>
              </div>
            </a>
          `).join('')}
        </div>`;
    }
    msg.innerHTML = `
      <div class="cleo-bubble">${escapeHtml(text).replace(/\n/g, '<br>')}${sourcesHtml}</div>
      <div class="cleo-msg-time">${time}</div>
    `;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  }

  function showTyping() {
    const container = document.getElementById('cleo-messages');
    const typing = document.createElement('div');
    typing.className = 'cleo-msg assistant cleo-typing-msg';
    typing.innerHTML = `
      <div class="cleo-bubble">
        <div class="cleo-typing">
          <div class="cleo-typing-dot"></div>
          <div class="cleo-typing-dot"></div>
          <div class="cleo-typing-dot"></div>
        </div>
      </div>
    `;
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
  }

  function hideTyping() {
    const typing = document.querySelector('.cleo-typing-msg');
    if (typing) typing.remove();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize
  function init() {
    createStyles();
    createFAB();
    createChatWindow();
    console.log('[Cleo] Initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for manual control
  window.Cleo = {
    open: () => { if (!isOpen) toggleChat(); },
    close: closeChat,
    ask: (q) => {
      document.getElementById('cleo-input').value = q;
      sendMessage();
    },
  };
})();