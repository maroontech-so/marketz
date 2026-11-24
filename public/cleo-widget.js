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

  // History & suggestions
  const MAX_HISTORY = 5;
  const STORAGE_KEY = 'cleo_chat_history';
  const SUGGESTIONS_KEY = 'cleo_suggestions';
  const MAX_SUGGESTIONS = 8;
  let chatHistory = [];
  let userSuggestions = [];

  const CATEGORY_LABELS = {
    equity_markets: 'Equities',
    corporate_developments: 'Corporate',
    fixed_income: 'Fixed Income',
    regulation_policy: 'Regulation',
    private_markets: 'Private Markets',
  };

  // Default quick prompts
  const DEFAULT_QUICK_PROMPTS = [
    'What are recent market trends?',
    'CBK & Monetary Policy',
    'NSE Announcements',
    'T-Bill Auction Results',
    'CMA Regulatory Updates',
    'Top NSE Companies',
  ];

  function loadHistory() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) chatHistory = JSON.parse(stored);
      const sugg = localStorage.getItem(SUGGESTIONS_KEY);
      if (sugg) userSuggestions = JSON.parse(sugg);
    } catch (e) {
      chatHistory = [];
      userSuggestions = [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chatHistory.slice(-MAX_HISTORY)));
      localStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(userSuggestions.slice(-MAX_SUGGESTIONS)));
    } catch (e) {}
  }

  function addToHistory(role, text, sources = []) {
    chatHistory.push({ role, text, sources, timestamp: Date.now() });
    if (chatHistory.length > MAX_HISTORY * 2) chatHistory = chatHistory.slice(-MAX_HISTORY * 2);
    saveHistory();
  }

  function addUserSuggestion(query) {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 3) return;
    userSuggestions = userSuggestions.filter(s => s.toLowerCase() !== trimmed.toLowerCase());
    userSuggestions.unshift(trimmed);
    if (userSuggestions.length > MAX_SUGGESTIONS) userSuggestions = userSuggestions.slice(0, MAX_SUGGESTIONS);
    saveHistory();
    renderSuggestions();
  }

  function getSuggestions() {
    if (userSuggestions.length > 0) {
      return userSuggestions.slice(0, 3);
    }
    return DEFAULT_QUICK_PROMPTS.slice(0, 3);
  }

  function createStyles() {
    const style = document.createElement('style');
    style.textContent = `
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      button, input, textarea { font: inherit; }
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
      @keyframes slide-up-fade {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes bubble-pop {
        0% { transform: scale(0.85); opacity: 0; }
        50% { transform: scale(1.02); }
        100% { transform: scale(1); opacity: 1; }
      }
      @keyframes suggestion-appear {
        from { opacity: 0; transform: translateY(8px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      .cleo-wrapper {
        position: fixed;
        bottom: 12px;
        right: 12px;
        z-index: 2147483640;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        pointer-events: none;
      }
      @media (min-width: 480px) {
        .cleo-wrapper { bottom: 16px; right: 16px; }
      }
      @media (min-width: 640px) {
        .cleo-wrapper { bottom: 20px; right: 20px; }
      }
      @media (min-width: 1024px) {
        .cleo-wrapper { bottom: 24px; right: 24px; }
      }
      .cleo-wrapper.is-fullpage {
        inset: 0;
        background: rgba(255, 255, 255, 0.98);
        align-items: center;
        justify-content: center;
        padding: 12px 8px;
        pointer-events: auto;
        height: 100dvh;
        overflow: hidden;
      }
      @media (min-width: 640px) {
        .cleo-wrapper.is-fullpage { padding: 24px 20px; }
      }
      @media (min-width: 1024px) {
        .cleo-wrapper.is-fullpage { padding: 32px 28px; }
      }

      .chat-window {
        margin-bottom: 8px;
        width: calc(100vw - 24px);
        max-width: 100%;
        max-height: calc(100dvh - 5rem);
        height: min(480px, calc(100dvh - 5rem));
        background: #fff;
        border: 1px solid #dbeafe;
        border-radius: 18px;
        box-shadow: 0 24px 60px -16px rgba(37, 99, 235, 0.18), 0 8px 24px -8px rgba(15, 23, 42, 0.08);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        transform-origin: bottom right;
        opacity: 0;
        transform: translateY(16px) scale(0.94);
        pointer-events: none;
        transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @media (min-width: 480px) {
        .chat-window { margin-bottom: 10px; width: calc(100vw - 32px); max-width: 380px; }
      }
      @media (min-width: 640px) {
        .chat-window { margin-bottom: 12px; width: 380px; }
      }
      .chat-window.is-open {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
        animation: slide-up-fade 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .cleo-wrapper.is-fullpage .chat-window {
        order: 2;
        margin-bottom: 0;
        width: 100%;
        max-width: 720px;
        flex: 1 1 0%;
        min-height: 0;
        max-height: none;
        height: auto;
        border-radius: 20px;
        box-shadow: 0 28px 70px -18px rgba(37, 99, 235, 0.16), 0 12px 32px -10px rgba(15, 23, 42, 0.1);
      }
      @media (min-width: 1280px) { .cleo-wrapper.is-fullpage .chat-window { max-width: 820px; } }
      @media (min-width: 1536px) { .cleo-wrapper.is-fullpage .chat-window { max-width: 960px; } }

      .chat-header {
        padding: 8px 10px;
        background: #fff;
        border-bottom: 1px solid #f1f5f9;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }
      @media (min-width: 640px) { .chat-header { padding: 12px 14px; } }
      .chat-title-row { display: flex; align-items: center; gap: 6px; }
      .chat-title { font-size: 12px; font-weight: 700; color: #0f172a; letter-spacing: -0.015em; }
      @media (min-width: 640px) { .chat-title { font-size: 14px; } }
      .chat-badge { padding: 1px 6px; background: #eff6ff; color: #2563eb; font-size: 8px; font-weight: 600; border-radius: 9999px; }
      .chat-status { font-size: 9px; color: #94a3b8; line-height: 1; margin-top: 1px; display: flex; align-items: center; gap: 5px; }
      .chat-status::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: #10b981; }
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
      .icon-btn:hover { color: #2563eb; background: #eff6ff; }
      .icon-btn.close-btn:hover { color: #334155; background: #f1f5f9; }
      .icon-svg { width: 14px; height: 14px; }
      @media (min-width: 640px) {
        .icon-svg { width: 16px; height: 16px; }
      }

      .chat-messages {
        flex: 1 1 0%;
        padding: 10px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: #f8fafc;
        scroll-behavior: smooth;
      }
      @media (min-width: 640px) { .chat-messages { padding: 14px; gap: 12px; } }
      .msg-row { display: flex; align-items: flex-start; gap: 6px; animation: slide-up-fade 0.25s ease-out; }
      .msg-row.user { justify-content: flex-end; flex-direction: row-reverse; }
      .msg-bubble {
        font-size: 12px;
        line-height: 1.6;
        padding: 8px 12px;
        border-radius: 16px;
        max-width: 88%;
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05), 0 1px 1px rgba(15, 23, 42, 0.03);
        word-wrap: break-word;
        overflow-wrap: anywhere;
        animation: bubble-pop 0.2s ease-out;
      }
      @media (min-width: 640px) {
        .msg-bubble { font-size: 13px; padding: 10px 14px; max-width: 82%; }
      }
      .msg-bubble.bot {
        background: #fff;
        border: 1px solid rgba(226, 232, 240, 0.8);
        color: #1e293b;
        border-top-left-radius: 4px;
        margin-right: auto;
      }
      .msg-bubble.user {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: #fff;
        border-top-right-radius: 4px;
        margin-left: auto;
      }
      .msg-bubble.bot .cleo-markdown { color: inherit; }
      .msg-bubble.user .cleo-markdown { color: #fff; }

      .cleo-markdown p { margin: 0 0 8px; }
      .cleo-markdown p:last-child { margin-bottom: 0; }
      .cleo-markdown strong { font-weight: 700; }
      .cleo-markdown em { font-style: italic; }
      .cleo-markdown code { font-size: 0.85em; background: rgba(37, 99, 235, 0.1); padding: 1px 5px; border-radius: 4px; font-family: 'SF Mono', 'Fira Code', monospace; }
      .cleo-markdown .msg-bubble.user code { background: rgba(255,255,255,0.2); }
      .cleo-markdown pre { margin: 10px 0; padding: 10px; background: #0f172a; border-radius: 8px; overflow-x: auto; }
      .cleo-markdown pre code { background: transparent; padding: 0; font-size: 11px; line-height: 1.5; color: #e2e8f0; display: block; }
      .cleo-markdown ul, .cleo-markdown ol { margin: 8px 0; padding-left: 18px; }
      .cleo-markdown li { margin: 4px 0; line-height: 1.55; }
      .cleo-markdown table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 11px; }
      .cleo-markdown th, .cleo-markdown td { padding: 6px 8px; border: 1px solid rgba(226, 232, 240, 0.6); text-align: left; }
      .cleo-markdown th { background: rgba(37, 99, 235, 0.08); font-weight: 600; }
      .cleo-markdown tr:nth-child(even) td { background: rgba(226, 232, 240, 0.3); }
      .cleo-markdown blockquote { margin: 10px 0; padding: 8px 12px; border-left: 2px solid #2563eb; background: rgba(37, 99, 235, 0.05); border-radius: 0 6px 6px 0; font-style: italic; color: #475569; font-size: 0.95em; }
      .cleo-markdown hr { border: 0; border-top: 1px solid #e2e8f0; margin: 12px 0; }
      .cleo-markdown a { color: #2563eb; text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 0.15s; }
      .cleo-markdown a:hover { border-bottom-color: #2563eb; }
      .msg-bubble.user .cleo-markdown a { color: #bfdbfe; border-bottom-color: transparent; }
      .msg-bubble.user .cleo-markdown a:hover { border-bottom-color: #bfdbfe; }
      .cleo-markdown h1, .cleo-markdown h2, .cleo-markdown h3 { margin: 10px 0 6px; font-weight: 700; line-height: 1.3; }
      .cleo-markdown h1 { font-size: 1.2em; }
      .cleo-markdown h2 { font-size: 1.1em; }
      .cleo-markdown h3 { font-size: 1.02em; }

      .typing-dots { display: flex; align-items: center; gap: 3px; padding: 8px 12px; }
      .typing-dot {
        width: 6px; height: 6px; border-radius: 9999px; background: #93c5fd;
        animation: typing-dot 1.2s infinite ease-in-out;
      }
      .typing-dot:nth-child(1) { background: #3b82f6; animation-delay: 0ms; }
      .typing-dot:nth-child(2) { animation-delay: 150ms; }
      .typing-dot:nth-child(3) { animation-delay: 300ms; }

      /* Inline sources */
      .cleo-inline-sources {
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px solid rgba(15, 23, 42, 0.06);
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        font-size: 10px;
      }
      .cleo-inline-source {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 2px 6px;
        background: rgba(37, 99, 235, 0.06);
        border-radius: 9999px;
        color: #2563eb;
        text-decoration: none;
        font-weight: 500;
        line-height: 1.3;
        transition: background 0.15s;
        white-space: nowrap;
      }
      .cleo-inline-source:hover { background: rgba(37, 99, 235, 0.12); }
      .msg-bubble.user .cleo-inline-source { background: rgba(255,255,255,0.2); color: #fff; }
      .msg-bubble.user .cleo-inline-source:hover { background: rgba(255,255,255,0.3); }

      /* Suggestions after response */
      .msg-suggestions {
        margin-top: 6px;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        animation: suggestion-appear 0.3s ease-out;
      }
      .msg-suggestion {
        padding: 4px 10px;
        background: #eff6ff;
        border: 1px solid rgba(37, 99, 235, 0.12);
        border-radius: 9999px;
        color: #1d4ed8;
        font-size: 10px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
      }
      .msg-suggestion:hover { background: #dbeafe; border-color: #3b82f6; transform: translateY(-1px); }
      .msg-bubble.user .msg-suggestion { background: rgba(255,255,255,0.15); border-color: rgba(255,255,255,0.2); color: #fff; }
      .msg-bubble.user .msg-suggestion:hover { background: rgba(255,255,255,0.25); }

      /* Quick prompts (initial) */
      .quick-prompts {
        padding: 6px 10px;
        background: #fff;
        border-top: 1px solid #f1f5f9;
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      @media (min-width: 640px) { .quick-prompts { padding: 8px 12px; } }
      .prompt-chip {
        white-space: nowrap;
        padding: 4px 10px;
        border-radius: 9999px;
        background: #eff6ff;
        color: #1d4ed8;
        font-size: 10px;
        font-weight: 500;
        border: 1px solid rgba(37, 99, 235, 0.12);
        transition: all 0.15s;
      }
      .prompt-chip:hover { background: #dbeafe; border-color: #3b82f6; transform: translateY(-1px); }
      @media (min-width: 640px) {
        .prompt-chip { padding: 5px 12px; font-size: 11px; }
      }

      .chat-form {
        padding: 8px 10px;
        background: #fff;
        border-top: 1px solid #f1f5f9;
        display: flex;
        align-items: flex-end;
        gap: 6px;
      }
      @media (min-width: 640px) { .chat-form { padding: 10px 12px; gap: 8px; } }
      .chat-input {
        min-width: 0;
        flex: 1 1 0%;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 8px 12px;
        font-size: 12px;
        color: #0f172a;
        outline: none;
        transition: border-color 0.15s, background-color 0.15s, box-shadow 0.15s;
        resize: none;
        min-height: 40px;
        max-height: 140px;
        line-height: 1.5;
      }
      .chat-input::placeholder { color: #94a3b8; }
      .chat-input:focus { border-color: #3b82f6; background: #fff; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1); }
      @media (min-width: 640px) {
        .chat-input { padding: 10px 14px; font-size: 13px; }
      }
      .send-btn {
        width: 40px;
        height: 40px;
        border-radius: 12px;
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: #fff;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
        transition: transform 0.1s, box-shadow 0.15s;
      }
      .send-btn:hover { box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35); transform: translateY(-1px); }
      .send-btn:active { transform: scale(0.96); }
      .send-btn svg { width: 18px; height: 18px; }
      @media (min-width: 640px) { .send-btn { width: 44px; height: 44px; } }

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
      @media (min-width: 640px) { .cleo-wrapper.is-fullpage .fab-container { margin-bottom: 16px; } }

      .reaction-bubble {
        position: absolute;
        bottom: calc(100% + 8px);
        right: 0;
        padding: 6px 12px;
        border-radius: 10px;
        background: #1e293b;
        color: #fff;
        font-size: 11px;
        font-weight: 500;
        box-shadow: 0 6px 20px rgba(15, 23, 42, 0.18), 0 2px 5px rgba(15, 23, 42, 0.08);
        opacity: 0;
        transform: translateY(8px) scale(0.9);
        transition: opacity 0.2s, transform 0.2s;
        pointer-events: none;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 5px;
        z-index: 10;
      }
      @media (max-width: 479px) {
        .reaction-bubble {
          right: 50%;
          transform: translateX(50%) translateY(8px) scale(0.9);
          font-size: 10px;
          padding: 5px 10px;
        }
        .reaction-bubble.is-visible {
          transform: translateX(50%) translateY(0) scale(1);
        }
      }
      @media (min-width: 480px) {
        .reaction-bubble { right: 0; }
      }
      .reaction-bubble.is-visible { opacity: 1; transform: translateY(0) scale(1); }
      @media (min-width: 480px) {
        .cleo-wrapper.is-fullpage .reaction-bubble {
          bottom: auto;
          top: 50%;
          right: auto;
          left: calc(100% + 12px);
          transform: translateY(-50%) translateX(8px) scale(0.9);
        }
        .cleo-wrapper.is-fullpage .reaction-bubble.is-visible {
          transform: translateY(-50%) translateX(0) scale(1);
        }
      }
      .reaction-bubble::after {
        content: '';
        position: absolute;
        left: 20px;
        bottom: -5px;
        width: 0;
        height: 0;
        border: 5px solid transparent;
        border-top-color: #1e293b;
      }
      @media (min-width: 480px) {
        .cleo-wrapper.is-fullpage .reaction-bubble::after {
          left: auto;
          right: 20px;
          top: 50%;
          bottom: auto;
          transform: translateY(-50%);
          border: 5px solid transparent;
          border-left-color: #1e293b;
        }
      }
      @media (max-width: 479px) {
        .reaction-bubble::after {
          left: 50%;
          transform: translateX(-50%);
          bottom: -5px;
          top: auto;
        }
      }

      .fab-tooltip {
        margin-right: 10px;
        padding: 5px 10px;
        border-radius: 9999px;
        background: #fff;
        border: 1px solid #dbeafe;
        box-shadow: 0 6px 20px -6px rgba(37, 99, 235, 0.18), 0 3px 8px -3px rgba(15, 23, 42, 0.06);
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
        gap: 5px;
      }
      .fab-container:hover .fab-tooltip { opacity: 1; transform: translateX(0); }
      .fab-tooltip.is-hidden, .cleo-wrapper.is-fullpage .fab-tooltip { display: none; }
      .tooltip-dot { width: 6px; height: 6px; border-radius: 9999px; background: #3b82f6; }

      .cleo-fab {
        position: relative;
        width: 56px;
        height: 56px;
        display: flex;
        align-items: center;
        justify-content: center;
        perspective: 420px;
      }
      @media (min-width: 640px) { .cleo-fab { width: 60px; height: 60px; } }
      .cleo-fab.is-floating { animation: cleo-float 3.5s ease-in-out infinite; }
      .cleo-shadow {
        position: absolute;
        bottom: -12px;
        width: 44px;
        height: 12px;
        border-radius: 9999px;
        pointer-events: none;
        background: radial-gradient(ellipse at center, rgba(15, 23, 42, 0.28) 0%, rgba(15, 23, 42, 0) 72%);
      }
      .cleo-pulse {
        position: absolute;
        inset: 0;
        border-radius: 20px;
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
      .cleo-fab:active .cleo-3d-stage { transform: scale3d(0.94, 0.94, 0.94); }
      .cleo-3d-stage.is-wiggling { animation: cleo-wiggle 0.55s ease-in-out; }

      .cleo-depth {
        position: absolute;
        inset: 0;
        border-radius: 20px;
        pointer-events: none;
        backface-visibility: hidden;
      }
      .cleo-front-shell {
        position: absolute;
        inset: 0;
        border-radius: 20px;
        border: 1px solid rgba(147, 197, 253, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        transform: translateZ(16px);
        background: linear-gradient(145deg, #60a5fa 0%, #2563eb 55%, #1d4ed8 100%);
        box-shadow: inset 0 3px 5px rgba(255, 255, 255, 0.5), inset 0 -4px 8px rgba(15, 23, 42, 0.4);
        backface-visibility: hidden;
      }
      .cleo-antenna {
        position: absolute;
        top: -12px;
        left: 50%;
        display: flex;
        flex-direction: column;
        align-items: center;
        transform-origin: bottom;
        animation: antenna-bob 2.4s ease-in-out infinite;
        pointer-events: none;
      }
      .cleo-antenna-orb {
        width: 10px;
        height: 10px;
        border-radius: 9999px;
        background: #bae6fd;
        border: 1.5px solid #fff;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.3);
        transition: transform 0.2s, background-color 0.2s;
      }
      .cleo-antenna-stem { width: 2.5px; height: 8px; background: #1d4ed8; border-radius: 9999px; }
      .cleo-ear-l, .cleo-ear-r {
        position: absolute;
        top: 50%;
        width: 7px;
        height: 18px;
        background: #1e40af;
        pointer-events: none;
      }
      .cleo-ear-l {
        left: 0;
        border-radius: 7px 0 0 7px;
        border-left: 1.5px solid rgba(147, 197, 253, 0.5);
        transform: translate3d(-5px, -50%, 4px) rotateY(-25deg);
      }
      .cleo-ear-r {
        right: 0;
        border-radius: 0 7px 7px 0;
        border-right: 1.5px solid rgba(147, 197, 253, 0.5);
        transform: translate3d(5px, -50%, 4px) rotateY(25deg);
      }
      .cleo-visor {
        position: relative;
        width: 42px;
        height: 34px;
        border-radius: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(160deg, #0f172a 0%, #1e293b 100%);
        box-shadow: inset 0 3px 6px rgba(0, 0, 0, 0.85), 0 1px 0 rgba(255, 255, 255, 0.25);
        transform: translateZ(19px);
        transform-style: preserve-3d;
      }
      .cleo-visor-rim {
        position: absolute;
        top: 3px;
        left: 8px;
        right: 8px;
        height: 2px;
        border-radius: 9999px;
        background: rgba(186, 230, 253, 0.25);
        pointer-events: none.
      }
      .cleo-face {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        transform: translateZ(7px);
        transition: opacity 0.2s;
      }
      .cleo-face.is-hidden { opacity: 0; }
      .cleo-eyes {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        transform: translate3d(0, 0, 7px);
      }
      .cleo-eye {
        position: relative;
        width: 7px;
        height: 12px;
        background: #f0f9ff;
        border-radius: 9999px;
        transform-origin: center;
        animation: cleo-blink 4.5s infinite;
        transition: transform 0.15s;
      }
      .cleo-eye-glint {
        position: absolute;
        top: 2.5px;
        right: 2.5px;
        width: 2px;
        height: 2px;
        background: #fff;
        border-radius: 9999px;
      }
      .cleo-mouth-row {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        margin-top: 3px;
      }
      .cleo-cheek {
        position: absolute;
        width: 7px;
        height: 5px;
        border-radius: 9999px;
        background: rgba(253, 164, 175, 0.9);
        opacity: 0;
        transition: opacity 0.2s;
      }
      .cleo-cheek.left { left: 0; }
      .cleo-cheek.right { right: 0; }
      .cleo-mouth {
        width: 10px;
        height: 7px;
        border-bottom: 2px solid #fff;
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
        transform: translateZ(7px) scale(0.5) rotate(45deg);
        transition: opacity 0.2s, transform 0.2s;
      }
      .cleo-close.is-visible {
        opacity: 1;
        transform: translateZ(7px) scale(1) rotate(0deg);
      }

      @media (max-width: 360px) {
        .cleo-fab { width: 52px; height: 52px; }
        .fab-tooltip { display: none !important; }
      }
      @media (min-width: 1920px) {
        .cleo-fab { transform: scale(1.08); transform-origin: bottom right; }
        .cleo-wrapper.is-fullpage .cleo-fab { transform: scale(1.15); transform-origin: top center; }
      }

      ::-webkit-scrollbar { width: 5px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 2.5px; border: 2px solid transparent; background-clip: padding-box; }
      ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
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
            <p class="chat-status">Ready</p>
          </div>
          <div class="chat-actions">
            <button id="expand-chat-btn" onclick="toggleExpandChat()" aria-label="Expand chat to full screen" title="Expand" class="icon-btn">
              <svg id="expand-icon-svg" class="icon-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path>
              </svg>
            </button>
            <button onclick="toggleChat()" aria-label="Close chat" title="Close" class="icon-btn close-btn">
              <svg class="icon-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
        </div>
        <div id="chat-messages" class="chat-messages"></div>
        <div class="quick-prompts" id="quick-prompts"></div>
        <form onsubmit="handleChatSubmit(event)" class="chat-form">
          <textarea id="chat-input" placeholder="Ask Cleo..." autocomplete="off" class="chat-input" rows="1" aria-label="Your question"></textarea>
          <button type="submit" aria-label="Send message" class="send-btn">
            <svg class="icon-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 12h14M12 5l7 7-7 7"></path>
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
            <div class="cleo-depth" style="background:#172554;transform:translateZ(-16px);"></div>
            <div class="cleo-depth" style="background:#1e40af;transform:translateZ(-8px);"></div>
            <div class="cleo-depth" style="background:#2563eb;transform:translateZ(4px);"></div>
            <div class="cleo-depth" style="background:#3b82f6;transform:translateZ(12px);"></div>
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
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </button>
      </div>
    `;
    document.body.appendChild(wrapper);
    loadHistory();
    restoreChat();
    renderSuggestions();
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
    if (eyes) eyes.style.transform = `translate3d(${currentEyeX.toFixed(2)}px,${currentEyeY.toFixed(2)}px,7px)`;

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
      bubbleTimer = setTimeout(() => bubble.classList.remove('is-visible'), 2500);
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
      if (mouth) { mouth.style.opacity = '1'; mouth.style.transform = 'scale(1)'; mouth.style.borderRadius = '0 0 9999px 9999px'; }
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
      if (mouth) { mouth.style.opacity = '1'; mouth.style.transform = 'scale(1)'; mouth.style.borderRadius = '0 0 9999px 9999px'; }
      if (cheekL) cheekL.style.opacity = '1';
      if (cheekR) cheekR.style.opacity = '1';
    } else if (type === 'surprised') {
      if (eyeL) eyeL.style.transform = 'scale(1.25)';
      if (eyeR) eyeR.style.transform = 'scale(1.25)';
      if (mouth) { mouth.style.opacity = '1'; mouth.style.transform = 'scale(0.9)'; mouth.style.borderRadius = '50%'; mouth.style.backgroundColor = '#fff'; }
      if (antennaOrb) antennaOrb.style.transform = 'scale(1.35)';
    } else if (type === 'curious') {
      if (eyeL) eyeL.style.transform = 'scaleY(1.15)';
      if (eyeR) eyeR.style.transform = 'scaleY(0.8)';
      targetRotZ = -10;
      startLoop();
    }

    reactionTimer = setTimeout(() => {
      isReacting = false;
      targetRotZ = 0;
      resetExpression();
      startLoop();
    }, 1500);
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
    targetEyeX = nx * 5;
    targetEyeY = ny * 4;

    if (dist < 170) {
      const pull = (1 - dist / 170) * 8;
      targetPullX = (dx / (dist || 1)) * pull;
      targetPullY = (dy / (dist || 1)) * pull;
      if (!isReacting && dist < 85) {
        const mouth = $('cleo-mouth');
        const cheekL = $('cleo-cheek-left');
        const cheekR = $('cleo-cheek-right');
        if (mouth) { mouth.style.opacity = '1'; mouth.style.transform = 'scale(0.95)'; mouth.style.borderRadius = '0 0 9999px 9999px'; }
        if (cheekL) cheekL.style.opacity = '0.9';
        if (cheekR) cheekR.style.opacity = '0.9';
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
        if (eyes) eyes.style.transform = 'translate3d(0,0,7px)';
      }
      setTimeout(() => input?.focus(), 180);
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
      if (eyes) eyes.style.transform = 'translate3d(0,0,7px)';
      if (expandBtn) { expandBtn.title = 'Expand chat'; expandBtn.setAttribute('aria-label', 'Expand chat to full screen'); }
      if (expandSvg) expandSvg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path>';
      requestAnimationFrame(updateMetrics);
    }
  }

  function renderSuggestions() {
    const container = $('quick-prompts');
    if (!container) return;
    const suggestions = getSuggestions();
    if (suggestions.length === 0) {
      container.style.display = 'none';
      return;
    }
    container.style.display = 'flex';
    container.innerHTML = suggestions.map(s =>
      `<button onclick="sendQuickPrompt('${s.replace(/'/g, "\\'")}')" class="prompt-chip">${s}</button>`
    ).join('');
  }

  function renderMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);

    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre><code class="language-${lang || ''}">${code.trim()}</code></pre>`;
    });
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^\|(.+)\|\s*\n\|[\s\-:|]+\|\s*\n((?:\|.+\|\s*\n?)+)/gm, (match, headerRow, bodyRows) => {
      const headers = headerRow.split('|').map(h => h.trim()).filter(Boolean);
      const rows = bodyRows.trim().split('\n').map(r => r.split('|').map(c => c.trim()).filter(Boolean));
      let tableHtml = '<table><thead><tr>';
      headers.forEach(h => { tableHtml += `<th>${h}</th>`; });
      tableHtml += '</tr></thead><tbody>';
      rows.forEach(row => {
        tableHtml += '<tr>';
        row.forEach(cell => { tableHtml += `<td>${cell}</td>`; });
        tableHtml += '</tr>';
      });
      tableHtml += '</tbody></table>';
      return tableHtml;
    });
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^---$/gm, '<hr>');
    html = html.replace(/^\- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    const lines = html.split('\n');
    const result = [];
    let inBlock = false;
    let blockContent = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const isBlockStart = /^<(h[1-3]|ul|ol|table|blockquote|pre|hr)/.test(trimmed);
      const isBlockEnd = /^<\/(h[1-3]|ul|ol|table|blockquote|pre)/.test(trimmed);

      if (isBlockStart) {
        if (blockContent) {
          result.push(`<p>${blockContent.trim()}</p>`);
          blockContent = '';
        }
        inBlock = true;
        result.push(line);
      } else if (isBlockEnd) {
        result.push(line);
        if (!/<(li|td|th)>/.test(line)) inBlock = false;
      } else if (trimmed === '') {
        if (blockContent) {
          result.push(`<p>${blockContent.trim()}</p>`);
          blockContent = '';
        }
        if (!inBlock) result.push('');
      } else {
        if (inBlock) {
          result.push(line);
        } else {
          blockContent += (blockContent ? ' ' : '') + line;
        }
      }
    }
    if (blockContent) result.push(`<p>${blockContent.trim()}</p>`);

    return result.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  function buildSourcesHtml(sources) {
    if (!sources || sources.length === 0) return '';
    return `
      <div class="cleo-inline-sources">
        ${sources.map(s => `
          <a href="${s.url}" target="_blank" rel="noopener noreferrer" class="cleo-inline-source" title="${escapeHtml(s.title)}">${escapeHtml(s.title.slice(0, 50))}${s.title.length > 50 ? '…' : ''}</a>
        `).join('')}
      </div>
    `;
  }

  function buildSuggestionsHtml(suggestions) {
    if (!suggestions || suggestions.length === 0) return '';
    return `
      <div class="msg-suggestions">
        ${suggestions.map(s => `
          <button onclick="sendQuickPrompt('${s.replace(/'/g, "\\'")}')" class="msg-suggestion">${s}</button>
        `).join('')}
      </div>
    `;
  }

  function generateFollowups(answer, sources) {
    const followups = [];
    const lower = answer.toLowerCase();
    if (lower.includes('cbk') || lower.includes('central bank')) followups.push('CBK interest rate decision');
    if (lower.includes('treasury') || lower.includes('t-bill') || lower.includes('auction')) followups.push('Latest T-bill auction results');
    if (lower.includes('crypto') || lower.includes('vasp') || lower.includes('licence')) followups.push('CMA crypto regulations');
    if (lower.includes('equity') || lower.includes('bank')) followups.push('Equity Group earnings');
    if (lower.includes('nse') || lower.includes('stock')) followups.push('NSE market performance');
    if (lower.includes('reserve') || lower.includes('forex')) followups.push('Kenya forex reserves');
    if (lower.includes('dividend')) followups.push('Upcoming NSE dividends');
    if (lower.includes('ipo') || lower.includes('listing')) followups.push('Upcoming NSE IPOs');
    
    // Add from sources
    sources.forEach(s => {
      if (s.title.toLowerCase().includes('cbk')) followups.push('CBK announcements');
      if (s.title.toLowerCase().includes('nse')) followups.push('NSE updates');
    });

    // Deduplicate and limit
    return [...new Set(followups)].slice(0, 3);
  }

  function appendMessage(sender, text, sources = [], isHistory = false) {
    const messages = $('chat-messages');
    if (!messages) return;

    const row = document.createElement('div');
    row.className = sender === 'user' ? 'msg-row user' : 'msg-row';

    const bbl = document.createElement('div');
    bbl.className = sender === 'user' ? 'msg-bubble user' : 'msg-bubble bot';

    if (sender === 'assistant') {
      const md = document.createElement('div');
      md.className = 'cleo-markdown';
      md.innerHTML = renderMarkdown(text);
      bbl.appendChild(md);
      
      // Inline sources
      const sourcesHtml = buildSourcesHtml(sources);
      if (sourcesHtml) {
        const sourcesDiv = document.createElement('div');
        sourcesDiv.innerHTML = sourcesHtml;
        bbl.appendChild(sourcesDiv);
      }

      // Followup suggestions
      const followups = generateFollowups(text, sources);
      if (followups.length > 0) {
        const suggDiv = document.createElement('div');
        suggDiv.innerHTML = buildSuggestionsHtml(followups);
        bbl.appendChild(suggDiv);
      }
    } else {
      bbl.textContent = text;
    }

    row.appendChild(bbl);
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;

    if (!isHistory) {
      addToHistory(sender, text, sources);
    }
  }

  function restoreChat() {
    const messages = $('chat-messages');
    if (!messages) return;
    
    if (chatHistory.length === 0) {
      // Show welcome message
      appendMessage('assistant', "Hey! I'm **Cleo**, your Kenya capital markets analyst. Ask me about trends, companies, T-bill auctions, regulations, or anything in the news.", [], true);
      return;
    }

    // Show last MAX_HISTORY exchanges
    const recent = chatHistory.slice(-MAX_HISTORY * 2);
    recent.forEach(msg => {
      appendMessage(msg.role, msg.text, msg.sources || [], true);
    });
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
    input.style.height = 'auto';

    appendMessage('user', text);
    addUserSuggestion(text);
    renderSuggestions();
    showTyping();

    // Build context from history (last 5 messages = ~2.5 exchanges)
    const contextMessages = chatHistory.slice(-MAX_HISTORY).map(m => ({ role: m.role, content: m.text }));

    try {
      const response = await fetch('/api/cleo/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          question: text, 
          options: { topK: 8 },
          history: contextMessages
        }),
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
    clearHistory: () => { chatHistory = []; userSuggestions = []; saveHistory(); const messages = $('chat-messages'); if (messages) messages.innerHTML = ''; restoreChat(); },
  };
})();