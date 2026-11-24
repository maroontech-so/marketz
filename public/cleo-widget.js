(function() {
  'use strict';

  const CLEO_API_BASE = '';
  let isOpen = false;
  let isFullPage = false;
  let isReacting = false;
  let isTyping = false;
  let lastMoveTime = Date.now();
  let lastX = 0, lastY = 0;
  let fabCenterX = 0, fabCenterY = 0;
  let targetRotX = 0, targetRotY = 0, targetRotZ = 0;
  let currentRotX = 0, currentRotY = 0, currentRotZ = 0;
  let targetPullX = 0, targetPullY = 0;
  let currentPullX = 0, currentPullY = 0;
  let targetEyeX = 0, targetEyeY = 0;
  let currentEyeX = 0, currentEyeY = 0;
  let rafId = null;
  let reactionTimer = null;
  let bubbleTimer = null;

  const CATEGORY_LABELS = {
    equity_markets: 'Equities',
    corporate_developments: 'Corporate',
    fixed_income: 'Fixed Income',
    regulation_policy: 'Regulation',
    private_markets: 'Private Markets',
  };

  const QUICK_PROMPTS = [
    { text: 'What are recent market trends?', action: 'trends', params: { days: 30 } },
    { text: 'CBK & Monetary Policy', action: 'institution', params: { code: 'CBK' } },
    { text: 'NSE Announcements', action: 'institution', params: { code: 'NSE' } },
    { text: 'T-Bill Auction Results', action: 'trends', params: { days: 14, category: 'fixed_income' } },
    { text: 'CMA Regulatory Updates', action: 'institution', params: { code: 'CMA' } },
    { text: 'Top NSE Companies', action: 'companies', params: {} },
  ];

  function createStyles() {
    const style = document.createElement('style');
    style.textContent = `
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      button, input { font: inherit; }
      button { border: 0; background: none; cursor: pointer; }

      @keyframes cleo-float {
        0%, 100% { transform: translate3d(0, 0, 0); }
        50% { transform: translate3d(0, -4px, 0); }
      }
      @keyframes cleo-blink {
        0%, 92%, 96%, 100% { transform: scaleY(1); }
        94%, 98% { transform: scaleY(0.1); }
      }
      @keyframes pulse-ring {
        0% { transform: scale3d(0.95, 0.95, 1); opacity: 0.35; }
        70%, 100% { transform: scale3d(1.32, 1.32, 1); opacity: 0; }
      }
      @keyframes antenna-bob {
        0%, 100% { transform: translate3d(-50%, 0, 2px) rotateZ(-6deg); }
        50% { transform: translate3d(-50%, 0, 2px) rotateZ(6deg); }
      }
      @keyframes cleo-wiggle {
        0%, 100% { transform: rotateZ(0deg) scale3d(1, 1, 1); }
        25% { transform: rotateZ(-7deg) scale3d(1.05, 1.05, 1); }
        50% { transform: rotateZ(6deg) scale3d(1.06, 1.06, 1); }
        75% { transform: rotateZ(-3deg) scale3d(1.03, 1.03, 1); }
      }
      @keyframes typing-dot {
        0%, 80%, 100% { transform: translateY(0); opacity: 0.45; }
        40% { transform: translateY(-3px); opacity: 1; }
      }

      .cleo-wrapper {
        position: fixed;
        bottom: 12px;
        right: 12px;
        z-index: 50;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        pointer-events: none;
      }
      @media (min-width: 640px) {
        .cleo-wrapper { bottom: 20px; right: 20px; }
      }
      .cleo-wrapper.is-fullpage {
        inset: 0;
        background: rgba(255, 255, 255, 0.97);
        align-items: center;
        justify-content: flex-start;
        padding: 12px 10px;
        pointer-events: auto;
      }
      @media (min-width: 640px) {
        .cleo-wrapper.is-fullpage { padding: 28px 24px 24px; }
      }

      .chat-window {
        margin-bottom: 10px;
        width: calc(100vw - 24px);
        max-width: 94vw;
        max-height: calc(100dvh - 5.5rem);
        height: min(440px, calc(100dvh - 5.5rem));
        background: #fff;
        border: 1px solid #dbeafe;
        border-radius: 16px;
        box-shadow: 0 20px 50px -12px rgba(37, 99, 235, 0.16);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        transform-origin: bottom right;
        opacity: 0;
        transform: translateY(12px) scale(0.95);
        pointer-events: none;
        transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @media (min-width: 640px) {
        .chat-window { margin-bottom: 14px; width: 350px; }
      }
      .chat-window.is-open {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }
      .cleo-wrapper.is-fullpage .chat-window {
        order: 2;
        margin-bottom: 0;
        width: 100%;
        max-width: 672px;
        flex: 1 1 0%;
        min-height: 0;
        max-height: none;
        height: auto;
        box-shadow: 0 20px 60px -15px rgba(37, 99, 235, 0.14);
      }
      @media (min-width: 1280px) { .cleo-wrapper.is-fullpage .chat-window { max-width: 768px; } }
      @media (min-width: 1536px) { .cleo-wrapper.is-fullpage .chat-window { max-width: 896px; } }

      .chat-header {
        padding: 10px 12px;
        background: #fff;
        border-bottom: 1px solid #f1f5f9;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
      }
      @media (min-width: 640px) { .chat-header { padding: 12px 16px; } }
      .chat-title-row { display: flex; align-items: center; gap: 6px; }
      .chat-title { font-size: 12px; font-weight: 600; color: #0f172a; letter-spacing: -0.01em; }
      .chat-badge { padding: 1px 6px; background: #eff6ff; color: #2563eb; font-size: 9px; font-weight: 500; border-radius: 6px; }
      .chat-status { font-size: 10px; color: #94a3b8; line-height: 1; margin-top: 2px; }
      .chat-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
      .icon-btn {
        padding: 6px;
        border-radius: 8px;
        color: #94a3b8;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: color 0.15s, background-color 0.15s;
      }
      .icon-btn:hover { color: #2563eb; background: rgba(239, 246, 255, 0.8); }
      .icon-btn.close-btn:hover { color: #334155; background: #f1f5f9; }
      .icon-svg { width: 14px; height: 14px; }
      @media (min-width: 640px) {
        .chat-title { font-size: 14px; }
        .chat-badge { font-size: 10px; }
        .chat-status { font-size: 11px; }
        .chat-actions { gap: 4px; }
        .icon-svg { width: 16px; height: 16px; }
      }

      .chat-messages {
        flex: 1 1 0%;
        padding: 12px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: rgba(248, 250, 252, 0.5);
        scroll-behavior: smooth;
      }
      @media (min-width: 640px) { .chat-messages { padding: 16px; gap: 14px; } }
      .msg-row { display: flex; align-items: flex-start; }
      .msg-row.user { justify-content: flex-end; align-items: flex-end; }
      .msg-bubble {
        font-size: 11px;
        line-height: 1.55;
        padding: 8px 12px;
        border-radius: 16px;
        max-width: 85%;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
        word-wrap: break-word;
      }
      .msg-bubble.bot {
        background: #fff;
        border: 1px solid rgba(226, 232, 240, 0.85);
        color: #334155;
        border-top-left-radius: 4px;
      }
      .msg-bubble.user {
        background: #2563eb;
        color: #fff;
        border-top-right-radius: 4px;
      }
      @media (min-width: 640px) {
        .msg-bubble { font-size: 13px; padding: 10px 14px; max-width: 75%; }
      }
      .typing-dots { display: flex; align-items: center; gap: 4px; padding: 10px 14px; }
      .typing-dot {
        width: 6px; height: 6px; border-radius: 9999px; background: #93c5fd;
        animation: typing-dot 1s infinite ease-in-out;
      }
      .typing-dot:nth-child(1) { background: #3b82f6; animation-delay: 0ms; }
      .typing-dot:nth-child(2) { animation-delay: 150ms; }
      .typing-dot:nth-child(3) { animation-delay: 300ms; }

      .quick-prompts {
        padding: 6px 10px;
        background: #fff;
        border-top: 1px solid #f1f5f9;
        display: flex;
        gap: 6px;
        overflow-x: auto;
      }
      .prompt-chip {
        white-space: nowrap;
        padding: 4px 8px;
        border-radius: 8px;
        background: rgba(239, 246, 255, 0.85);
        color: #1d4ed8;
        font-size: 10px;
        font-weight: 500;
        transition: background-color 0.15s;
      }
      .prompt-chip:hover { background: rgba(219, 234, 254, 0.95); }
      @media (min-width: 640px) {
        .quick-prompts { padding: 8px 14px; }
        .prompt-chip { padding: 4px 10px; font-size: 11px; }
      }
      .chat-form {
        padding: 8px;
        background: #fff;
        border-top: 1px solid #f1f5f9;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .chat-input {
        min-width: 0;
        flex: 1 1 0%;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 6px 10px;
        font-size: 11px;
        color: #0f172a;
        outline: none;
        transition: border-color 0.15s, background-color 0.15s;
      }
      .chat-input::placeholder { color: #94a3b8; }
      .chat-input:focus { border-color: #3b82f6; background: #fff; }
      .send-btn {
        padding: 6px;
        border-radius: 12px;
        background: #2563eb;
        color: #fff;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 1px 2px rgba(37, 99, 235, 0.2);
        transition: background-color 0.15s, transform 0.1s;
      }
      .send-btn:hover { background: #3b82f6; }
      .send-btn:active { transform: scale(0.95); }
      @media (min-width: 640px) {
        .chat-form { padding: 12px; gap: 8px; }
        .chat-input { padding: 8px 14px; font-size: 13px; }
        .send-btn { padding: 8px; }
      }

      .fab-container {
        position: relative;
        display: flex;
        align-items: center;
        pointer-events: auto;
      }
      .cleo-wrapper.is-fullpage .fab-container {
        flex-direction: column;
        justify-content: center;
        order: 1;
        margin-bottom: 10px;
        z-index: 20;
      }
      @media (min-width: 640px) { .cleo-wrapper.is-fullpage .fab-container { margin-bottom: 20px; } }

      .reaction-bubble {
        position: absolute;
        top: -40px;
        right: 0;
        padding: 4px 10px;
        border-radius: 9999px;
        background: #2563eb;
        color: #fff;
        font-size: 10px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
        opacity: 0;
        transform: translateY(8px) scale(0.9);
        transition: opacity 0.2s, transform 0.2s;
        pointer-events: none;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .reaction-bubble.is-visible { opacity: 1; transform: translateY(0) scale(1); }
      .cleo-wrapper.is-fullpage .reaction-bubble {
        top: 6px;
        right: auto;
        left: calc(100% + 10px);
      }
      @media (min-width: 640px) { .reaction-bubble { font-size: 11px; } }

      .fab-tooltip {
        margin-right: 12px;
        padding: 4px 10px;
        border-radius: 9999px;
        background: #fff;
        border: 1px solid #dbeafe;
        box-shadow: 0 8px 20px -6px rgba(37, 99, 235, 0.16);
        font-size: 11px;
        font-weight: 500;
        color: #334155;
        opacity: 0;
        transform: translateX(8px);
        transition: opacity 0.2s, transform 0.2s;
        pointer-events: none;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .fab-container:hover .fab-tooltip { opacity: 1; transform: translateX(0); }
      .fab-tooltip.is-hidden, .cleo-wrapper.is-fullpage .fab-tooltip { display: none; }
      .tooltip-dot { width: 6px; height: 6px; border-radius: 9999px; background: #3b82f6; }

      .cleo-fab {
        position: relative;
        width: 52px;
        height: 52px;
        display: flex;
        align-items: center;
        justify-content: center;
        perspective: 420px;
      }
      .cleo-fab.is-floating { animation: cleo-float 3.5s ease-in-out infinite; }
      .cleo-shadow {
        position: absolute;
        bottom: -10px;
        width: 40px;
        height: 10px;
        border-radius: 9999px;
        pointer-events: none;
        background: radial-gradient(ellipse at center, rgba(15, 23, 42, 0.26) 0%, rgba(15, 23, 42, 0) 72%);
      }
      .cleo-pulse {
        position: absolute;
        inset: 0;
        border-radius: 18px;
        border: 2px solid rgba(96, 165, 250, 0.4);
        animation: pulse-ring 3s cubic-bezier(0.24, 0, 0.38, 1) infinite;
        pointer-events: none;
      }
      .cleo-3d-stage {
        position: relative;
        width: 100%;
        height: 100%;
        transform-style: preserve-3d;
        transition: transform 0.075s;
      }
      .cleo-fab:active .cleo-3d-stage { transform: scale3d(0.95, 0.95, 0.95); }
      .cleo-3d-stage.is-wiggling { animation: cleo-wiggle 0.55s ease-in-out; }

      .cleo-depth {
        position: absolute;
        inset: 0;
        border-radius: 18px;
        pointer-events: none;
        backface-visibility: hidden;
      }
      .cleo-front-shell {
        position: absolute;
        inset: 0;
        border-radius: 18px;
        border: 1px solid rgba(147, 197, 253, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        transform: translateZ(14px);
        background: linear-gradient(145deg, #60a5fa 0%, #2563eb 55%, #1d4ed8 100%);
        box-shadow: inset 0 2px 3px rgba(255, 255, 255, 0.55), inset 0 -3px 6px rgba(15, 23, 42, 0.45);
        backface-visibility: hidden;
      }
      .cleo-antenna {
        position: absolute;
        top: -10px;
        left: 50%;
        display: flex;
        flex-direction: column;
        align-items: center;
        transform-origin: bottom;
        animation: antenna-bob 2.4s ease-in-out infinite;
        pointer-events: none;
      }
      .cleo-antenna-orb {
        width: 8px;
        height: 8px;
        border-radius: 9999px;
        background: #bae6fd;
        border: 1px solid #fff;
        transition: transform 0.2s, background-color 0.2s;
      }
      .cleo-antenna-stem { width: 2px; height: 6px; background: #2563eb; border-radius: 9999px; }
      .cleo-ear-l, .cleo-ear-r {
        position: absolute;
        top: 50%;
        width: 6px;
        height: 16px;
        background: #1e40af;
        pointer-events: none;
      }
      .cleo-ear-l {
        left: 0;
        border-radius: 6px 0 0 6px;
        border-left: 1px solid rgba(147, 197, 253, 0.5);
        transform: translate3d(-4px, -50%, 3px) rotateY(-25deg);
      }
      .cleo-ear-r {
        right: 0;
        border-radius: 0 6px 6px 0;
        border-right: 1px solid rgba(147, 197, 253, 0.5);
        transform: translate3d(4px, -50%, 3px) rotateY(25deg);
      }
      .cleo-visor {
        position: relative;
        width: 38px;
        height: 31px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(160deg, #0f172a 0%, #1e293b 100%);
        box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.8), 0 1px 0 rgba(255, 255, 255, 0.25);
        transform: translateZ(17px);
        transform-style: preserve-3d;
      }
      .cleo-visor-rim {
        position: absolute;
        top: 2px;
        left: 6px;
        right: 6px;
        height: 1.5px;
        border-radius: 9999px;
        background: rgba(186, 230, 253, 0.25);
        pointer-events: none;
      }
      .cleo-face {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        transform: translateZ(6px);
        transition: opacity 0.2s;
      }
      .cleo-face.is-hidden { opacity: 0; }
      .cleo-eyes {
        position: relative;
        display: flex;
        align-items: center;
        gap: 8px;
        transform: translate3d(0, 0, 6px);
      }
      .cleo-eye {
        position: relative;
        width: 6px;
        height: 10px;
        background: #f0f9ff;
        border-radius: 9999px;
        transform-origin: center;
        animation: cleo-blink 4.5s infinite;
        transition: transform 0.15s;
      }
      .cleo-eye-glint {
        position: absolute;
        top: 2px;
        right: 2px;
        width: 1.5px;
        height: 1.5px;
        background: #fff;
        border-radius: 9999px;
      }
      .cleo-mouth-row {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        margin-top: 2px;
      }
      .cleo-cheek {
        position: absolute;
        width: 6px;
        height: 4px;
        border-radius: 9999px;
        background: rgba(253, 164, 175, 0.85);
        opacity: 0;
        transition: opacity 0.2s;
      }
      .cleo-cheek.left { left: 0; }
      .cleo-cheek.right { right: 0; }
      .cleo-mouth {
        width: 8px;
        height: 6px;
        border-bottom: 1.8px solid #fff;
        border-radius: 9999px;
        opacity: 0;
        transform: scale(0.5);
        transition: opacity 0.2s, transform 0.2s, border-radius 0.2s, background-color 0.2s;
      }
      .cleo-close {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        opacity: 0;
        transform: translateZ(6px) scale(0.5) rotate(45deg);
        transition: opacity 0.2s, transform 0.2s;
      }
      .cleo-close.is-visible {
        opacity: 1;
        transform: translateZ(6px) scale(1) rotate(0deg);
      }

      .cleo-sources { margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(0,0,0,0.08); }
      .cleo-sources-label { font-size: 11px; font-weight: 600; color: #6B7280; margin-bottom: 6px; }
      .cleo-source-item {
        display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px;
        background: rgba(37, 99, 235, 0.06); border-radius: 10px; margin-bottom: 6px;
        cursor: pointer; transition: background 0.15s; font-size: 12px;
      }
      .cleo-source-item:hover { background: rgba(37, 99, 235, 0.12); }
      .cleo-source-icon { width: 20px; height: 20px; flex-shrink: 0; color: #2563eb; }
      .cleo-source-info { flex: 1; min-width: 0; }
      .cleo-source-title { font-weight: 600; color: #111315; line-clamp: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cleo-source-meta { font-size: 10px; color: #6B7280; display: flex; gap: 8px; margin-top: 2px; }
      .cleo-source-score { font-weight: 600; color: #2563eb; }

      @media (max-width: 300px) {
        .cleo-fab { transform: scale(0.76); transform-origin: bottom right; }
        .cleo-wrapper.is-fullpage .cleo-fab { transform: scale(0.72); transform-origin: top center; }
        .fab-tooltip { display: none !important; }
      }
      @media (min-width: 1920px) {
        .cleo-fab { transform: scale(1.06); transform-origin: bottom right; }
        .cleo-wrapper.is-fullpage .cleo-fab { transform: scale(1.12); transform-origin: top center; }
      }
    `;
    document.head.appendChild(style);
  }

  function createWidget() {
    const wrapper = document.createElement('div');
    wrapper.id = 'chatbot-wrapper';
    wrapper.className = 'cleo-wrapper';
    wrapper.innerHTML = `
      <div id="chat-window" class="chat-window">
        <div class="chat-header">
          <div>
            <div class="chat-title-row">
              <h3 class="chat-title">Cleo</h3>
              <span class="chat-badge">AI</span>
            </div>
            <p class="chat-status">Online & ready</p>
          </div>
          <div class="chat-actions">
            <button id="expand-chat-btn" onclick="toggleExpandChat()" aria-label="Expand chat to full screen" title="Expand chat" class="icon-btn">
              <svg id="expand-icon-svg" class="icon-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path>
              </svg>
            </button>
            <button onclick="toggleChat()" aria-label="Close chat" title="Close chat" class="icon-btn close-btn">
              <svg class="icon-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
        </div>
        <div id="chat-messages" class="chat-messages">
          <div class="msg-row">
            <div class="msg-bubble bot">
              Hey! I'm <strong style="color:#2563eb;font-weight:600;">Cleo</strong>. Ask me about Kenya's capital markets—trends, companies, auctions, regulations, or anything in the news.
            </div>
          </div>
        </div>
        <div class="quick-prompts" id="quick-prompts"></div>
        <form onsubmit="handleChatSubmit(event)" class="chat-form">
          <input type="text" id="chat-input" placeholder="Ask Cleo..." autocomplete="off" class="chat-input">
          <button type="submit" aria-label="Send message" class="send-btn">
            <svg class="icon-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M12 5l7 7-7 7"></path>
            </svg>
          </button>
        </form>
      </div>
      <div class="fab-container" id="fab-container">
        <div id="cleo-reaction-bubble" class="reaction-bubble">
          <span id="cleo-reaction-text">👋 Hey!</span>
        </div>
        <div id="fab-tooltip" class="fab-tooltip">
          <span class="tooltip-dot"></span>
          <span>Ask Cleo</span>
        </div>
        <button id="cleo-fab" onclick="handleCleoClick()" aria-label="Chat with Cleo" class="cleo-fab is-floating">
          <span class="cleo-shadow"></span>
          <span class="cleo-pulse"></span>
          <div id="cleo-body" class="cleo-3d-stage">
            <div class="cleo-depth" style="background:#172554;transform:translateZ(-14px);"></div>
            <div class="cleo-depth" style="background:#1e40af;transform:translateZ(-6px);"></div>
            <div class="cleo-depth" style="background:#2563eb;transform:translateZ(4px);"></div>
            <div class="cleo-depth" style="background:#3b82f6;transform:translateZ(10px);"></div>
            <div id="cleo-antenna" class="cleo-antenna">
              <span id="cleo-antenna-orb" class="cleo-antenna-orb"></span>
              <span class="cleo-antenna-stem"></span>
            </div>
            <span class="cleo-ear-l"></span>
            <span class="cleo-ear-r"></span>
            <div class="cleo-front-shell">
              <div class="cleo-visor">
                <div class="cleo-visor-rim"></div>
                <div id="cleo-face" class="cleo-face">
                  <div id="cleo-eyes" class="cleo-eyes">
                    <div id="cleo-eye-left" class="cleo-eye"><span class="cleo-eye-glint"></span></div>
                    <div id="cleo-eye-right" class="cleo-eye"><span class="cleo-eye-glint"></span></div>
                  </div>
                  <div class="cleo-mouth-row">
                    <span id="cleo-cheek-left" class="cleo-cheek left"></span>
                    <div id="cleo-mouth" class="cleo-mouth"></div>
                    <span id="cleo-cheek-right" class="cleo-cheek right"></span>
                  </div>
                </div>
                <div id="cleo-close" class="cleo-close">
                  <svg class="icon-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M6 18L18 6M6 6l12 12"></path>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </button>
      </div>
    `;
    document.body.appendChild(wrapper);
    renderQuickPrompts();
    updateMetrics();
    window.addEventListener('resize', updateMetrics, { passive: true });
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    startLoop();
  }

  function $(id) { return document.getElementById(id); }

  function updateMetrics() {
    const fab = $('cleo-fab');
    if (!fab) return;
    const r = fab.getBoundingClientRect();
    fabCenterX = r.left + r.width * 0.5;
    fabCenterY = r.top + r.height * 0.5;
  }

  function startLoop() {
    if (!rafId) rafId = requestAnimationFrame(renderStep);
  }

  function renderStep() {
    rafId = null;
    if (isOpen && !isFullPage) return;

    const ease = 0.15;
    currentRotX += (targetRotX - currentRotX) * ease;
    currentRotY += (targetRotY - currentRotY) * ease;
    currentRotZ += (targetRotZ - currentRotZ) * ease;
    currentPullX += (targetPullX - currentPullX) * ease;
    currentPullY += (targetPullY - currentPullY) * ease;
    currentEyeX += (targetEyeX - currentEyeX) * 0.22;
    currentEyeY += (targetEyeY - currentEyeY) * 0.22;

    const body = $('cleo-body');
    const eyes = $('cleo-eyes');
    if (body) body.style.transform = `translate3d(${currentPullX.toFixed(2)}px,${currentPullY.toFixed(2)}px,0) rotateX(${currentRotX.toFixed(2)}deg) rotateY(${currentRotY.toFixed(2)}deg) rotateZ(${currentRotZ.toFixed(2)}deg)`;
    if (eyes) eyes.style.transform = `translate3d(${currentEyeX.toFixed(2)}px,${currentEyeY.toFixed(2)}px,6px)`;

    const settled =
      Math.abs(targetRotX - currentRotX) < 0.03 &&
      Math.abs(targetRotY - currentRotY) < 0.03 &&
      Math.abs(targetPullX - currentPullX) < 0.03 &&
      Math.abs(targetEyeX - currentEyeX) < 0.03;

    if (!settled) startLoop();
  }

  function showBubble(text) {
    if (!text) return;
    const bubble = $('cleo-reaction-bubble');
    const bubbleText = $('cleo-reaction-text');
    if (bubble && bubbleText) {
      bubbleText.textContent = text;
      bubble.classList.add('is-visible');
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(() => bubble.classList.remove('is-visible'), 2100);
    }
  }

  function resetExpression() {
    const eyeL = $('cleo-eye-left');
    const eyeR = $('cleo-eye-right');
    const mouth = $('cleo-mouth');
    const cheekL = $('cleo-cheek-left');
    const cheekR = $('cleo-cheek-right');
    const antennaOrb = $('cleo-antenna-orb');
    if (eyeL) eyeL.style.transform = '';
    if (eyeR) eyeR.style.transform = '';
    if (mouth) {
      mouth.style.opacity = '0';
      mouth.style.transform = 'scale(0.5)';
      mouth.style.borderRadius = '9999px';
      mouth.style.backgroundColor = 'transparent';
    }
    if (cheekL) cheekL.style.opacity = '0';
    if (cheekR) cheekR.style.opacity = '0';
    if (antennaOrb) antennaOrb.style.transform = '';
  }

  function triggerReaction(type, text) {
    if (isOpen && !isFullPage) return;
    isReacting = true;
    clearTimeout(reactionTimer);
    resetExpression();
    if (text) showBubble(text);

    const mouth = $('cleo-mouth');
    const eyeL = $('cleo-eye-left');
    const eyeR = $('cleo-eye-right');
    const cheekL = $('cleo-cheek-left');
    const cheekR = $('cleo-cheek-right');
    const antennaOrb = $('cleo-antenna-orb');
    const body = $('cleo-body');

    if (type === 'happy') {
      if (mouth) { mouth.style.opacity = '1'; mouth.style.transform = 'scale(1)'; }
      if (cheekL) cheekL.style.opacity = '1';
      if (cheekR) cheekR.style.opacity = '1';
      if (antennaOrb) antennaOrb.style.transform = 'scale(1.3)';
      if (body) {
        body.classList.remove('is-wiggling');
        void body.offsetWidth;
        body.classList.add('is-wiggling');
      }
    } else if (type === 'wink') {
      if (eyeR) eyeR.style.transform = 'scaleY(0.15)';
      if (mouth) { mouth.style.opacity = '1'; mouth.style.transform = 'scale(1)'; }
      if (cheekL) cheekL.style.opacity = '1';
      if (cheekR) cheekR.style.opacity = '1';
    } else if (type === 'surprised') {
      if (eyeL) eyeL.style.transform = 'scale(1.22)';
      if (eyeR) eyeR.style.transform = 'scale(1.22)';
      if (mouth) { mouth.style.opacity = '1'; mouth.style.transform = 'scale(0.85)'; mouth.style.backgroundColor = '#fff'; }
      if (antennaOrb) antennaOrb.style.transform = 'scale(1.35)';
    } else if (type === 'curious') {
      if (eyeL) eyeL.style.transform = 'scaleY(1.12)';
      if (eyeR) eyeR.style.transform = 'scaleY(0.82)';
      targetRotZ = -10;
      startLoop();
    }

    reactionTimer = setTimeout(() => {
      isReacting = false;
      targetRotZ = 0;
      resetExpression();
      startLoop();
    }, 1350);
  }

  function onPointerMove(e) {
    if (isOpen && !isFullPage) return;
    const now = Date.now();
    const dt = Math.max(now - lastMoveTime, 1);
    const dxMove = e.clientX - lastX;
    const dyMove = e.clientY - lastY;
    const speed = Math.hypot(dxMove, dyMove) / dt;

    lastMoveTime = now;
    lastX = e.clientX;
    lastY = e.clientY;

    const dx = e.clientX - fabCenterX;
    const dy = e.clientY - fabCenterY;
    const dist = Math.hypot(dx, dy);
    const nx = Math.max(-1, Math.min(1, dx / 360));
    const ny = Math.max(-1, Math.min(1, dy / 360));

    targetRotY = nx * 24;
    targetRotX = -ny * 24;
    targetEyeX = nx * 4.5;
    targetEyeY = ny * 3.5;

    if (dist < 170) {
      const pull = (1 - dist / 170) * 6;
      targetPullX = (dx / (dist || 1)) * pull;
      targetPullY = (dy / (dist || 1)) * pull;
      if (!isReacting && dist < 85) {
        const mouth = $('cleo-mouth');
        const cheekL = $('cleo-cheek-left');
        const cheekR = $('cleo-cheek-right');
        if (mouth) { mouth.style.opacity = '1'; mouth.style.transform = 'scale(0.95)'; }
        if (cheekL) cheekL.style.opacity = '0.85';
        if (cheekR) cheekR.style.opacity = '0.85';
      }
    } else {
      targetPullX = 0;
      targetPullY = 0;
      if (!isReacting) resetExpression();
    }

    if (!isReacting && dist < 210 && speed > 3.2) {
      triggerReaction('surprised', 'Whoa! ⚡');
    }

    startLoop();
  }

  function handleCleoClick() {
    if (isFullPage) {
      triggerReaction('happy', 'Hey there! 👋');
    } else {
      toggleChat();
    }
  }

  function toggleChat() {
    if (isFullPage) toggleExpandChat();
    isOpen = !isOpen;

    const chatWindow = $('chat-window');
    const cleoFace = $('cleo-face');
    const cleoClose = $('cleo-close');
    const cleoFab = $('cleo-fab');
    const tooltip = $('fab-tooltip');
    const bubble = $('cleo-reaction-bubble');
    const input = $('chat-input');

    if (isOpen) {
      chatWindow.classList.add('is-open');
      if (cleoFace) cleoFace.classList.add('is-hidden');
      if (cleoClose) cleoClose.classList.add('is-visible');
      if (cleoFab) cleoFab.classList.remove('is-floating');
      if (tooltip) tooltip.classList.add('is-hidden');
      if (bubble) bubble.classList.remove('is-visible');

      targetRotX = targetRotY = targetRotZ = targetPullX = targetPullY = 0;
      currentRotX = currentRotY = currentRotZ = currentPullX = currentPullY = 0;
      if (cleoFab) {
        const body = $('cleo-body');
        const eyes = $('cleo-eyes');
        if (body) body.style.transform = 'translate3d(0,0,0) rotateX(0deg) rotateY(0deg)';
        if (eyes) eyes.style.transform = 'translate3d(0,0,6px)';
      }
      setTimeout(() => input?.focus(), 160);
    } else {
      chatWindow.classList.remove('is-open');
      if (cleoFace) cleoFace.classList.remove('is-hidden');
      if (cleoClose) cleoClose.classList.remove('is-visible');
      if (cleoFab) cleoFab.classList.add('is-floating');
      if (tooltip) tooltip.classList.remove('is-hidden');
      requestAnimationFrame(() => {
        updateMetrics();
        triggerReaction('happy', 'See ya! ✨');
      });
    }
  }

  function toggleExpandChat() {
    isFullPage = !isFullPage;
    const wrapper = $('chatbot-wrapper');
    const cleoFace = $('cleo-face');
    const cleoClose = $('cleo-close');
    const cleoFab = $('cleo-fab');
    const expandBtn = $('expand-chat-btn');
    const expandSvg = $('expand-icon-svg');
    const input = $('chat-input');

    if (isFullPage) {
      wrapper.classList.add('is-fullpage');
      if (cleoFace) cleoFace.classList.remove('is-hidden');
      if (cleoClose) cleoClose.classList.remove('is-visible');
      if (cleoFab) cleoFab.classList.add('is-floating');
      if (expandBtn) { expandBtn.title = 'Collapse chat'; expandBtn.setAttribute('aria-label', 'Collapse chat'); }
      if (expandSvg) expandSvg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25"></path>';
      requestAnimationFrame(() => {
        updateMetrics();
        triggerReaction('happy', 'Full view! ✨');
      });
      setTimeout(() => input?.focus(), 150);
    } else {
      wrapper.classList.remove('is-fullpage');
      if (cleoFace) cleoFace.classList.add('is-hidden');
      if (cleoClose) cleoClose.classList.add('is-visible');
      if (cleoFab) cleoFab.classList.remove('is-floating');
      targetRotX = targetRotY = targetRotZ = targetPullX = targetPullY = 0;
      currentRotX = currentRotY = currentRotZ = currentPullX = currentPullY = 0;
      const body = $('cleo-body');
      const eyes = $('cleo-eyes');
      if (body) body.style.transform = 'translate3d(0,0,0) rotateX(0deg) rotateY(0deg)';
      if (eyes) eyes.style.transform = 'translate3d(0,0,6px)';
      if (expandBtn) { expandBtn.title = 'Expand chat'; expandBtn.setAttribute('aria-label', 'Expand chat to full screen'); }
      if (expandSvg) expandSvg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path>';
      requestAnimationFrame(updateMetrics);
    }
  }

  function renderQuickPrompts() {
    const container = $('quick-prompts');
    if (!container) return;
    container.innerHTML = QUICK_PROMPTS.map(p =>
      `<button onclick="sendQuickPrompt('${p.text.replace(/'/g, "\\'")}')" class="prompt-chip">${p.text}</button>`
    ).join('');
  }

  function appendMessage(sender, text, sources = []) {
    const messages = $('chat-messages');
    if (!messages) return;

    const row = document.createElement('div');
    row.className = sender === 'user' ? 'msg-row user' : 'msg-row';
    const bbl = document.createElement('div');
    bbl.className = sender === 'user' ? 'msg-bubble user' : 'msg-bubble bot';
    bbl.textContent = text;
    row.appendChild(bbl);

    if (sender === 'assistant' && sources.length > 0) {
      const sourcesDiv = document.createElement('div');
      sourcesDiv.className = 'cleo-sources';
      sourcesDiv.innerHTML = `
        <div class="cleo-sources-label">Sources (${sources.length})</div>
        ${sources.map(s => `
          <a href="${s.url}" target="_blank" rel="noopener noreferrer" class="cleo-source-item">
            <svg class="cleo-source-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg>
            <div class="cleo-source-info">
              <div class="cleo-source-title">${escapeHtml(s.title)}</div>
              <div class="cleo-source-meta">
                <span>${escapeHtml(s.source)}</span>
                <span>${CATEGORY_LABELS[s.category] || s.category}</span>
                <span class="cleo-source-score">${s.relevanceScore}% match</span>
              </div>
            </div>
          </a>
        `).join('')}
      `;
      row.appendChild(sourcesDiv);
    }

    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
  }

  function showTyping() {
    const messages = $('chat-messages');
    if (!messages) return;
    const typingRow = document.createElement('div');
    typingRow.className = 'msg-row cleo-typing-msg';
    typingRow.innerHTML = '<div class="msg-bubble bot typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>';
    messages.appendChild(typingRow);
    messages.scrollTop = messages.scrollHeight;
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

  window.handleChatSubmit = async function(e) {
    e.preventDefault();
    const input = $('chat-input');
    const text = input.value.trim();
    if (!text || isTyping) return;

    isTyping = true;
    input.value = '';

    appendMessage('user', text);
    showTyping();

    try {
      const response = await fetch('/api/cleo/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, options: { topK: 8 } }),
      });

      hideTyping();

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      appendMessage('assistant', data.answer, data.sources || []);
      if (isFullPage) triggerReaction('happy');
    } catch (err) {
      hideTyping();
      appendMessage('assistant', `Sorry, I couldn't process that. ${err.message}`, []);
    } finally {
      isTyping = false;
    }
  };

  window.sendQuickPrompt = function(text) {
    const input = $('chat-input');
    if (input) input.value = text;
    const event = { preventDefault: () => {} };
    window.handleChatSubmit(event);
  };

  window.handleCleoClick = handleCleoClick;
  window.toggleChat = toggleChat;
  window.toggleExpandChat = toggleExpandChat;

  function init() {
    createStyles();
    createWidget();
    console.log('[Cleo] Initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.Cleo = {
    open: () => { if (!isOpen) toggleChat(); },
    close: toggleChat,
    ask: (q) => { const input = $('chat-input'); if (input) input.value = q; window.handleChatSubmit({ preventDefault: () => {} }); },
  };
})();