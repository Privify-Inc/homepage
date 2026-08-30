/**
 * Sentry — Privify AI sales agent widget.
 * Vanilla JS, no build step, no dependencies. Shadow DOM for style
 * isolation (spec 4.1). Reads its own <script> tag's data attributes for
 * configuration.
 */
(function () {
  'use strict';

  var SCRIPT = document.currentScript;
  var PAGE = (SCRIPT && SCRIPT.dataset.sentryPage) || 'unknown';
  var API_BASE = (SCRIPT && SCRIPT.dataset.sentryApi) || 'https://api.privify.io/api';
  var CSS_HREF = SCRIPT ? new URL('./sentry.css', SCRIPT.src).href : '/assets/sentry/sentry.css';
  var IS_SHIELD = PAGE.toLowerCase().indexOf('shield') !== -1;

  var STORAGE_KEY = 'privify-sentry-session';
  var TRANSCRIPT_KEY = 'privify-sentry-transcript';

  // The Sentry mark — kept inline rather than <img src="sentry-mark.svg"> so it
  // inherits currentColor through the shadow boundary and needs no extra
  // request. Must stay in step with assets/sentry/sentry-mark.svg, which is the
  // canonical source and carries the design rationale.
  var MARK_SVG =
    '<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" class="mark" aria-hidden="true">' +
    '<path d="M23.5 9.2 A9.5 9.5 0 1 0 25.4 14.2" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="16" cy="16" r="2.4" fill="currentColor"/>' +
    '</svg>';

  var GREETING = IS_SHIELD
    ? "I'm Sentry, Privify's AI assistant. I can answer questions about SHIELD and get you on the waitlist."
    : "I'm Sentry, Privify's AI assistant. I can answer questions about FORGE and Scout, and book you time with our team.";

  // ── State ────────────────────────────────────────────────────────────

  var sessionId = null;
  var streaming = false;
  var opened = false;
  try {
    sessionId = sessionStorage.getItem(STORAGE_KEY);
  } catch (e) {
    /* storage may be unavailable (private browsing, blocked) — fine, just no persistence */
  }

  // ── DOM ──────────────────────────────────────────────────────────────

  var host = document.createElement('div');
  host.id = 'privify-sentry-root';
  var shadow = host.attachShadow({ mode: 'open' });

  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_HREF;
  shadow.appendChild(link);

  shadow.innerHTML +=
    '<button type="button" class="launcher" aria-label="Ask Sentry" aria-expanded="false">' +
    MARK_SVG +
    '<span>Ask Sentry</span>' +
    '</button>' +
    '<div class="panel" role="dialog" aria-modal="false" aria-labelledby="sentry-title" aria-hidden="true">' +
    '  <div class="header">' +
    '    <div class="header-row">' +
    '      <div class="wordmark">' +
    MARK_SVG +
    '        <span id="sentry-title">Sentry</span>' +
    '      </div>' +
    '      <div class="header-actions">' +
    '        <button type="button" class="icon-btn close-btn" aria-label="Close">✕</button>' +
    '      </div>' +
    '    </div>' +
    '    <div class="disclosure">AI assistant · Your messages are used to route your enquiry.</div>' +
    '  </div>' +
    '  <div class="thread" tabindex="-1"></div>' +
    '  <div class="sr-only" aria-live="polite"></div>' +
    '  <div class="composer">' +
    '    <textarea rows="1" placeholder="Ask Sentry something…" aria-label="Message"></textarea>' +
    '    <button type="button" class="send-btn" aria-label="Send" disabled>' +
    '      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16M13 5l7 7-7 7"/></svg>' +
    '    </button>' +
    '  </div>' +
    '</div>';

  var launcher = shadow.querySelector('.launcher');
  var panel = shadow.querySelector('.panel');
  var closeBtn = shadow.querySelector('.close-btn');
  var thread = shadow.querySelector('.thread');
  var announcer = shadow.querySelector('.sr-only');
  var textarea = shadow.querySelector('textarea');
  var sendBtn = shadow.querySelector('.send-btn');

  document.body.appendChild(host);

  // ── Theming ──────────────────────────────────────────────────────────
  // Colors cascade automatically via CSS custom properties (spec 4.4); the
  // mirrored [data-theme] on the host covers any rule that needs a hard
  // branch rather than a swapped variable. No event fires on toggle
  // (theme.js just flips the attribute), so this uses a MutationObserver.

  function syncTheme() {
    var theme = document.documentElement.getAttribute('data-theme');
    if (theme) host.setAttribute('data-theme', theme);
    else host.removeAttribute('data-theme');
  }
  syncTheme();
  new MutationObserver(syncTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  // ── Entrance ─────────────────────────────────────────────────────────

  function reveal() {
    setTimeout(function () {
      launcher.classList.add('is-visible');
    }, 800);
  }
  if (document.readyState === 'complete') reveal();
  else window.addEventListener('load', reveal);

  // ── Panel open/close ─────────────────────────────────────────────────

  function openPanel() {
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    launcher.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKeydown);

    if (!opened) {
      opened = true;
      restoreTranscript();
      if (thread.children.length === 0) {
        appendMessage('sentry', GREETING);
      }
    }
    textarea.focus();
  }

  function closePanel() {
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    launcher.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKeydown);
    launcher.focus();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') closePanel();
  }

  launcher.addEventListener('click', function () {
    if (panel.classList.contains('is-open')) closePanel();
    else openPanel();
  });
  closeBtn.addEventListener('click', closePanel);

  // ── Transcript persistence (local rendering cache only — the server
  //    holds the authoritative turns; see spec 3.2) ────────────────────

  function saveTranscript() {
    try {
      var text = [];
      thread.querySelectorAll('.msg-sentry, .msg-visitor').forEach(function (el) {
        text.push({ role: el.classList.contains('msg-visitor') ? 'visitor' : 'sentry', text: el.textContent });
      });
      sessionStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(text));
    } catch (e) {
      /* ignore */
    }
  }

  function restoreTranscript() {
    try {
      var raw = sessionStorage.getItem(TRANSCRIPT_KEY);
      if (!raw) return;
      var items = JSON.parse(raw);
      items.forEach(function (item) {
        appendMessage(item.role === 'visitor' ? 'visitor' : 'sentry', item.text, { skipSave: true });
      });
    } catch (e) {
      /* ignore corrupt cache */
    }
  }

  // ── Message rendering ────────────────────────────────────────────────

  function scrollToBottom() {
    thread.scrollTop = thread.scrollHeight;
  }

  function appendMessage(role, text, opts) {
    var el = document.createElement('div');
    el.className = 'msg ' + (role === 'visitor' ? 'msg-visitor' : 'msg-sentry');
    el.textContent = text;
    thread.appendChild(el);
    scrollToBottom();
    if (!opts || !opts.skipSave) saveTranscript();
    return el;
  }

  function appendPulse() {
    var el = document.createElement('div');
    el.className = 'pulse';
    el.innerHTML = '<span></span><span></span><span></span>';
    thread.appendChild(el);
    scrollToBottom();
    return el;
  }

  /** Builds a DOM element with attributes/children — used instead of
   * innerHTML wherever a value (like a config-supplied URL) is interpolated,
   * so nothing dynamic ever passes through HTML string concatenation. */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        node.setAttribute(key, attrs[key]);
      });
    }
    (children || []).forEach(function (child) {
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function appendCardNode(node) {
    var card = document.createElement('div');
    card.className = 'card';
    card.appendChild(node);
    thread.appendChild(card);
    scrollToBottom();
    return card;
  }

  /** Only http(s) URLs from our own config are ever rendered as links/iframes. */
  function isSafeUrl(url) {
    try {
      var parsed = new URL(url, window.location.href);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch (e) {
      return false;
    }
  }

  // Sent on session create so Sentry states times in the visitor's own zone
  // instead of guessing one. The server validates it and falls back to UTC.
  function visitorTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) {
      return '';
    }
  }

  // Prefer the server's label: it is rendered in the same zone Sentry names in
  // its message, so the card and the sentence can't disagree. Local formatting
  // is only a fallback for an older response shape.
  function formatSlot(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      });
    } catch (e) {
      return iso;
    }
  }

  function renderToolResult(tool, result) {
    if (tool === 'check_availability') {
      if (!result || !result.slots || result.slots.length === 0) {
        appendMessage('sentry', "I'm having trouble pulling up the calendar right now — let's try again in a moment.");
        return;
      }
      var slotButtons = result.slots.map(function (slot) {
        var label = slot.label || formatSlot(slot.start);
        var btn = el('button', { type: 'button', class: 'btn btn-secondary' }, [label]);
        btn.addEventListener('click', function () {
          sendMessage(label + ' works for me.');
        });
        return btn;
      });
      appendCardNode(
        el('div', { class: 'card-body' }, [
          el('div', { class: 'card-title' }, ['Pick a time']),
          el('div', { class: 'card-actions' }, slotButtons),
        ])
      );
    } else if (tool === 'book_appointment') {
      if (result && result.ok) {
        appendCardNode(
          el('div', { class: 'card-body' }, [
            el('div', { class: 'card-title' }, ['Booked']),
            el('div', { class: 'card-desc' }, [(result.label || formatSlot(result.start)) + ' — see you then.']),
          ])
        );
      } else {
        appendMessage('sentry', (result && result.error) || "That slot didn't go through — let's find another time.");
      }
    } else if (tool === 'offer_scout' && result) {
      if (result.available && result.url && isSafeUrl(result.url)) {
        var downloadBtn = el('a', { class: 'btn btn-primary', href: result.url, target: '_blank', rel: 'noopener' }, [
          'Download Scout',
        ]);
        var walkthroughBtn = el('button', { type: 'button', class: 'btn btn-secondary' }, [
          'Have someone walk me through it',
        ]);
        walkthroughBtn.addEventListener('click', function () {
          sendMessage('Can someone walk me through the Scout report with me?');
        });
        appendCardNode(
          el('div', { class: 'card-body' }, [
            el('div', { class: 'card-title' }, ['Scout']),
            el('div', { class: 'card-desc' }, ['A self-serve scan of what AI is actually running in your environment.']),
            el('div', { class: 'card-actions' }, [downloadBtn, walkthroughBtn]),
          ])
        );
      } else {
        appendMessage('sentry', "Scout access is being set up right now — I'll get you the call instead.");
      }
    }
  }

  // ── Composer ─────────────────────────────────────────────────────────

  function autoGrow() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 96) + 'px';
  }
  textarea.addEventListener('input', autoGrow);

  textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitComposer();
    }
  });
  sendBtn.addEventListener('click', submitComposer);

  function updateSendEnabled() {
    sendBtn.disabled = streaming || textarea.value.trim().length === 0;
  }
  textarea.addEventListener('input', updateSendEnabled);

  function submitComposer() {
    var text = textarea.value.trim();
    if (!text || streaming) return;
    textarea.value = '';
    autoGrow();
    updateSendEnabled();
    sendMessage(text);
  }

  // ── API ──────────────────────────────────────────────────────────────

  function ensureSession() {
    if (sessionId) return Promise.resolve(sessionId);
    return fetch(API_BASE + '/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryPage: PAGE, timeZone: visitorTimeZone() }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('session creation failed');
        return res.json();
      })
      .then(function (data) {
        sessionId = data.sessionId;
        try {
          sessionStorage.setItem(STORAGE_KEY, sessionId);
        } catch (e) {
          /* ignore */
        }
        return sessionId;
      });
  }

  function announce(text) {
    announcer.textContent = text;
  }

  function sendMessage(text) {
    appendMessage('visitor', text);
    streaming = true;
    updateSendEnabled();
    var pulse = appendPulse();
    var currentBubble = null;
    var fullText = '';

    ensureSession()
      .then(function (sid) {
        return fetch(API_BASE + '/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid, message: text }),
        });
      })
      .then(function (res) {
        if (!res.ok || !res.body) throw new Error('chat request failed');
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';

        function pump() {
          return reader.read().then(function (result) {
            if (result.done) return;
            buffer += decoder.decode(result.value, { stream: true });
            var parts = buffer.split('\n\n');
            buffer = parts.pop();
            parts.forEach(handleEvent);
            return pump();
          });
        }
        return pump();
      })
      .catch(function () {
        if (pulse.parentNode) pulse.remove();
        // No "booking link" exists — booking is conversational now.
        appendMessage('error', 'Something went wrong there. Try sending that again.');
      })
      .finally(function () {
        streaming = false;
        updateSendEnabled();
      });

    function handleEvent(block) {
      var eventType = 'message';
      var dataLines = [];
      block.split('\n').forEach(function (line) {
        if (line.indexOf('event:') === 0) eventType = line.slice(6).trim();
        else if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim());
      });
      if (dataLines.length === 0) return;
      var data;
      try {
        data = JSON.parse(dataLines.join('\n'));
      } catch (e) {
        return;
      }

      if (eventType === 'text') {
        if (pulse.parentNode) pulse.remove();
        if (!currentBubble) currentBubble = appendMessage('sentry', '', { skipSave: true });
        fullText += data.text;
        currentBubble.textContent = fullText;
        scrollToBottom();
      } else if (eventType === 'tool_result') {
        renderToolResult(data.tool, data.result);
      } else if (eventType === 'lead_updated') {
        // No visible UI yet — fan-out confirmation arrives with Section 6.
      } else if (eventType === 'error') {
        if (pulse.parentNode) pulse.remove();
        appendMessage('error', data.message || 'Something went wrong.');
      } else if (eventType === 'done') {
        if (fullText) announce(fullText);
        saveTranscript();
        // Re-enable input here, not in .finally(). The reader loop runs until
        // the stream CLOSES, and the server deliberately keeps it open past
        // this event to finish lead delivery — work the visitor knows nothing
        // about. Waiting for close would leave them unable to type through it.
        // .finally() still runs and is harmless: this is idempotent.
        streaming = false;
        updateSendEnabled();
      }
    }
  }
})();
