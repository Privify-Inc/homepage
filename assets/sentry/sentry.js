/**
 * Sentry — Privify AI sales agent widget.
 * Vanilla JS, no build step, no dependencies. Shadow DOM for style
 * isolation (spec 4.1). Reads its own <script> tag's data attributes for
 * configuration.
 *
 * Structure follows spec Part 10: the chrome, streaming, theming, storage and
 * accessibility are a generic chat shell (`PrivifyChat.createShell`) that
 * knows nothing about selling. Everything sales-specific — the greeting, the
 * endpoint, and how a tool result is drawn — arrives as configuration at the
 * bottom of this file.
 *
 * Phase 2 (walking a customer through their own Scout report) is a different
 * agent against a different endpoint with an auth context. It is NOT built
 * here. The seam for it is: load this file, then call
 * `PrivifyChat.createShell` again with its own config and storage namespace.
 * Two shells can coexist because nothing below is global except the factory.
 */
(function () {
  'use strict';

  // ── Generic chat shell ────────────────────────────────────────────────
  // Nothing in this section may mention selling, booking, or Scout. If
  // something here needs to know about those, it belongs in the agent config.

  function createShell(config) {
    var API_BASE = config.apiBase;
    var PAGE = config.page;
    var STORAGE_KEY = config.namespace + '-session';
    var TRANSCRIPT_KEY = config.namespace + '-transcript';

    // ── State ──────────────────────────────────────────────────────────

    var sessionId = null;
    var streaming = false;
    var restored = false;
    /**
     * The rendered conversation, as data rather than scraped DOM. Kept so that
     * navigating between pages re-draws what the visitor was looking at —
     * sessionStorage survives same-origin navigation, so this is what makes
     * the widget feel continuous across the site rather than resetting on
     * every click. The server still holds the authoritative turns (spec 3.2);
     * this is only a rendering cache.
     */
    var transcript = [];

    function readStored(key) {
      try {
        return sessionStorage.getItem(key);
      } catch (e) {
        return null; // private browsing or blocked storage — degrade to no persistence
      }
    }
    function writeStored(key, value) {
      try {
        sessionStorage.setItem(key, value);
      } catch (e) {
        /* ignore */
      }
    }
    function clearStored(key) {
      try {
        sessionStorage.removeItem(key);
      } catch (e) {
        /* ignore */
      }
    }

    sessionId = readStored(STORAGE_KEY);
    try {
      transcript = JSON.parse(readStored(TRANSCRIPT_KEY) || '[]');
      if (!Array.isArray(transcript)) transcript = [];
    } catch (e) {
      transcript = [];
    }

    function saveTranscript() {
      writeStored(TRANSCRIPT_KEY, JSON.stringify(transcript));
    }

    // ── DOM ────────────────────────────────────────────────────────────

    var host = document.createElement('div');
    host.id = config.rootId;
    var shadow = host.attachShadow({ mode: 'open' });

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = config.cssHref;
    shadow.appendChild(link);

    shadow.innerHTML +=
      '<button type="button" class="launcher" aria-label="' + config.launcherLabel + '" aria-expanded="false">' +
      config.markSvg +
      '<span>' + config.launcherLabel + '</span>' +
      '</button>' +
      '<div class="panel" role="dialog" aria-modal="false" aria-labelledby="sentry-title" aria-hidden="true">' +
      '  <div class="header">' +
      '    <div class="header-row">' +
      '      <div class="wordmark">' +
      config.markSvg +
      '        <span id="sentry-title">' + config.title + '</span>' +
      '      </div>' +
      '      <div class="header-actions">' +
      '        <button type="button" class="icon-btn close-btn" aria-label="Close">✕</button>' +
      '      </div>' +
      '    </div>' +
      '    <div class="disclosure">' +
      '      <span>' + config.disclosure + '</span>' +
      // Spec 8 requires the privacy page to be reachable from the widget
      // header, not buried in a reply the visitor has to ask for.
      '      <a class="privacy-link" href="' + config.privacyUrl + '" target="_blank" rel="noopener">Privacy</a>' +
      '    </div>' +
      // Addendum 7.2: the exits live in the header so they are available at
      // all times, not only when the agent decides to offer them. Someone who
      // does not want to talk to an AI should not have to negotiate with the
      // AI to find a way out of it.
      '    <div class="exits">' +
      '      <button type="button" class="exit-btn exit-book">Book a call</button>' +
      '      <a class="exit-btn" href="mailto:' + config.contactEmail + '">' + config.contactEmail + '</a>' +
      '    </div>' +
      '  </div>' +
      '  <div class="thread" tabindex="-1"></div>' +
      '  <div class="sr-only" aria-live="polite"></div>' +
      '  <div class="composer">' +
      '    <textarea rows="1" placeholder="' + config.placeholder + '" aria-label="Message"></textarea>' +
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

    // ── Theming ────────────────────────────────────────────────────────
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

    // ── Entrance ───────────────────────────────────────────────────────

    function reveal() {
      setTimeout(function () {
        launcher.classList.add('is-visible');
      }, 800);
    }
    if (document.readyState === 'complete') reveal();
    else window.addEventListener('load', reveal);

    // ── Panel open/close ───────────────────────────────────────────────

    function openPanel() {
      panel.classList.add('is-open');
      panel.setAttribute('aria-hidden', 'false');
      launcher.setAttribute('aria-expanded', 'true');
      document.addEventListener('keydown', onKeydown);
      hydrate();
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

    shadow.querySelector('.exit-book').addEventListener('click', function () {
      if (streaming) return;
      sendMessage(config.bookingRequest);
    });

    /** Draws the stored conversation, or the greeting on a fresh one. */
    function hydrate() {
      if (restored) return;
      restored = true;
      transcript.forEach(function (entry) {
        if (entry.kind === 'tool') {
          if (config.restoreToolResult && !config.restoreToolResult(entry.tool)) return;
          renderToolResult(entry.tool, entry.result, { restored: true });
        } else if (entry.text) {
          appendMessage(entry.role === 'visitor' ? 'visitor' : 'sentry', entry.text);
        }
      });
      if (thread.children.length === 0) appendMessage('sentry', config.greeting);
    }

    /**
     * What an agent's tool renderer is allowed to touch. Deliberately narrow:
     * a renderer draws and can send a message, and has no access to the
     * session, the transport, or the transcript.
     *
     * Assigned HERE, above the auto-open below, and not at the end of this
     * function. Everything it holds is a hoisted function declaration, but the
     * object itself is not — and the auto-open path calls hydrate() during
     * this function's own execution, so a restored tool card would otherwise
     * be drawn with `undefined` for its UI.
     */
    var shellApi = {
      el: el,
      appendMessage: appendMessage,
      appendCardNode: appendCardNode,
      isSafeUrl: isSafeUrl,
      sendMessage: sendMessage,
      open: openPanel,
      close: closePanel,
    };

    // The panel is reopened after a navigation only when there is a
    // conversation to return to. Spec 11's "never auto-opens" is about not
    // ambushing a visitor who has not engaged: on a fresh page view the
    // transcript is empty and this does nothing. Once someone has opened it
    // and started talking, closing it under them on every internal link would
    // be the bug, not the fix.
    if (transcript.length > 0) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', openPanel);
      } else {
        openPanel();
      }
    }

    // ── Message rendering ──────────────────────────────────────────────

    function scrollToBottom() {
      thread.scrollTop = thread.scrollHeight;
    }

    function appendMessage(role, text) {
      var node = document.createElement('div');
      node.className = 'msg ' + (role === 'visitor' ? 'msg-visitor' : role === 'error' ? 'msg-error' : 'msg-sentry');
      node.textContent = text;
      thread.appendChild(node);
      scrollToBottom();
      return node;
    }

    function appendPulse() {
      var node = document.createElement('div');
      node.className = 'pulse';
      node.innerHTML = '<span></span><span></span><span></span>';
      thread.appendChild(node);
      scrollToBottom();
      return node;
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

    /** Only http(s) URLs from our own config are ever rendered as links. */
    function isSafeUrl(url) {
      try {
        var parsed = new URL(url, window.location.href);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
      } catch (e) {
        return false;
      }
    }

    function announce(text) {
      announcer.textContent = text;
    }

    var fallbackShown = false;

    /**
     * Addendum 7.5: a broken Sentry must still capture leads.
     *
     * Both routes here are deliberately independent of our backend — the
     * booking page is Microsoft's and the address is a plain mailto — so this
     * card works precisely when nothing else does. Rendered once per page
     * view: repeating it after every failed retry would be nagging, which
     * 7.4 rules out.
     */
    function renderFallback() {
      if (fallbackShown) return;
      fallbackShown = true;
      var bookLink = el(
        'a',
        { class: 'btn btn-primary', href: config.bookingUrl, target: '_blank', rel: 'noopener' },
        ['Book a call']
      );
      appendCardNode(
        el('div', { class: 'card-body' }, [
          el('div', { class: 'card-title' }, ['Reach us directly']),
          el('div', { class: 'card-desc' }, [
            "While I'm having trouble, these both work without me — book a time, or email the team at " +
              config.contactEmail + '.',
          ]),
          el('div', { class: 'card-actions' }, [
            bookLink,
            el('a', { class: 'btn btn-secondary', href: 'mailto:' + config.contactEmail }, [config.contactEmail]),
          ]),
        ])
      );
    }

    function renderToolResult(tool, result, opts) {
      config.renderToolResult(shellApi, tool, result, opts || {});
    }

    // ── Composer ───────────────────────────────────────────────────────

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

    // ── API ────────────────────────────────────────────────────────────

    function visitorTimeZone() {
      // Sent on session create so the agent states times in the visitor's own
      // zone instead of guessing one. The server validates it, falling back
      // to UTC.
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      } catch (e) {
        return '';
      }
    }

    function createSession() {
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
          writeStored(STORAGE_KEY, sessionId);
          return sessionId;
        });
    }

    function ensureSession() {
      if (sessionId) return Promise.resolve(sessionId);
      return createSession();
    }

    /**
     * Sessions expire — they are purged server-side after 30 days (spec 8),
     * and a redeploy of local storage drops them sooner. Without this, the
     * stored id is handed back forever and every message 404s, leaving the
     * tab permanently broken with a generic "something went wrong". So a 404
     * discards the dead session and retries once with a fresh one.
     */
    function postChat(text, isRetry, onSessionReset) {
      return ensureSession()
        .then(function (sid) {
          return fetch(API_BASE + '/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sid, message: text }),
          });
        })
        .then(function (res) {
          if (res.status === 404 && !isRetry) {
            sessionId = null;
            clearStored(STORAGE_KEY);
            // The new session starts empty server-side, so the model has no
            // memory of anything above. Saying so is better than letting the
            // visitor discover it by being asked something they already
            // answered.
            appendMessage('error', config.sessionExpiredNotice);
            onSessionReset();
            return postChat(text, true, onSessionReset);
          }
          return res;
        });
    }

    function sendMessage(text) {
      appendMessage('visitor', text);
      transcript.push({ kind: 'msg', role: 'visitor', text: text });
      // Reserve the assistant's slot now so tool cards logged mid-turn sort
      // after it. The bubble is rendered above the cards (it keeps growing as
      // later rounds stream in), so appending on 'done' would replay the
      // conversation in the wrong order after a navigation.
      var slot = transcript.push({ kind: 'msg', role: 'sentry', text: '' }) - 1;
      saveTranscript();

      streaming = true;
      updateSendEnabled();
      var pulse = appendPulse();
      var currentBubble = null;
      var fullText = '';

      // A recovered session has no memory of the entries above, so the stored
      // transcript is rebuilt around just this exchange — otherwise a later
      // navigation would redraw history the model cannot see, which is the
      // confusion the notice exists to prevent.
      function onSessionReset() {
        transcript = [
          { kind: 'msg', role: 'visitor', text: text },
          { kind: 'msg', role: 'sentry', text: '' },
        ];
        slot = 1;
        saveTranscript();
      }

      postChat(text, false, onSessionReset)
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
          appendMessage('error', 'Something went wrong there. Try sending that again.');
          renderFallback();
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
          if (!currentBubble) currentBubble = appendMessage('sentry', '');
          fullText += data.text;
          currentBubble.textContent = fullText;
          scrollToBottom();
        } else if (eventType === 'tool_result') {
          renderToolResult(data.tool, data.result);
          transcript.push({ kind: 'tool', tool: data.tool, result: data.result });
          saveTranscript();
        } else if (eventType === 'lead_updated') {
          // No visible UI — the fan-out is deliberately invisible to the visitor.
        } else if (eventType === 'error') {
          if (pulse.parentNode) pulse.remove();
          appendMessage('error', data.message || 'Something went wrong.');
        } else if (eventType === 'done') {
          if (fullText) announce(fullText);
          if (transcript[slot]) transcript[slot].text = fullText;
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

    return shellApi;
  }

  window.PrivifyChat = window.PrivifyChat || {};
  window.PrivifyChat.createShell = createShell;

  // ── Sentry: the Phase 1 sales agent ───────────────────────────────────
  // Everything below is sales-specific and is what a second agent would
  // replace wholesale.

  var SCRIPT = document.currentScript;
  var PAGE = (SCRIPT && SCRIPT.dataset.sentryPage) || 'unknown';
  var API_BASE = (SCRIPT && SCRIPT.dataset.sentryApi) || 'https://api.privify.io/api';
  var CSS_HREF = SCRIPT ? new URL('./sentry.css', SCRIPT.src).href : '/assets/sentry/sentry.css';
  var IS_SHIELD = PAGE.toLowerCase().indexOf('shield') !== -1;

  // The Sentry mark — kept inline rather than <img src="sentry-mark.svg"> so it
  // inherits currentColor through the shadow boundary and needs no extra
  // request. Must stay in step with assets/sentry/sentry-mark.svg, which is the
  // canonical source and carries the design rationale.
  var MARK_SVG =
    '<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" class="mark" aria-hidden="true">' +
    '<path d="M23.5 9.2 A9.5 9.5 0 1 0 25.4 14.2" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="16" cy="16" r="2.4" fill="currentColor"/>' +
    '</svg>';

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

  function renderAvailability(ui, result) {
    if (!result) return;
    // A lookup that failed and a calendar that is genuinely empty are
    // different things. Only the first is "having trouble"; for the second
    // Sentry's own message already explains it, and a card here would just
    // contradict whatever it said.
    if (result.error) {
      ui.appendMessage('sentry', "I'm having trouble pulling up the calendar right now — let's try again in a moment.");
      return;
    }
    if (!result.slots || result.slots.length === 0) return;

    // Slots span several days, so group them under a day heading and put only
    // the time on each button — six full "Tuesday, September 2 at 2:00 PM PDT"
    // labels is a wall in a 400px panel. The full label still rides along for
    // screen readers and for the message the click sends.
    var groups = [];
    result.slots.forEach(function (slot) {
      var day = slot.day || formatSlot(slot.start);
      var last = groups.length ? groups[groups.length - 1] : null;
      if (!last || last.day !== day) {
        last = { day: day, slots: [] };
        groups.push(last);
      }
      last.slots.push(slot);
    });

    // When every slot is in the same zone — the normal case — name it once
    // under the title instead of stamping "PDT" on all six buttons. A
    // fortnight can straddle a DST change though, and then they genuinely
    // differ, so fall back to labelling each button.
    var zones = result.slots
      .map(function (slot) { return slot.zone; })
      .filter(function (zone, i, all) { return zone && all.indexOf(zone) === i; });
    var sharedZone = zones.length === 1 ? zones[0] : null;

    var dayBlocks = groups.map(function (group) {
      var buttons = group.slots.map(function (slot) {
        var full = slot.label || formatSlot(slot.start);
        var face = slot.time ? (sharedZone || !slot.zone ? slot.time : slot.time + ' ' + slot.zone) : full;
        var btn = ui.el('button', { type: 'button', class: 'btn btn-secondary', 'aria-label': full }, [face]);
        btn.addEventListener('click', function () {
          ui.sendMessage(full + ' works for me.');
        });
        return btn;
      });
      return ui.el('div', { class: 'slot-day' }, [
        ui.el('div', { class: 'slot-day-label' }, [group.day]),
        ui.el('div', { class: 'card-actions' }, buttons),
      ]);
    });

    var head = [ui.el('div', { class: 'card-title' }, ['Pick a time'])];
    if (sharedZone) head.push(ui.el('div', { class: 'card-desc' }, ['All times ' + sharedZone]));
    ui.appendCardNode(ui.el('div', { class: 'card-body' }, head.concat(dayBlocks)));
  }

  function renderBooking(ui, result) {
    if (result && result.ok) {
      ui.appendCardNode(
        ui.el('div', { class: 'card-body' }, [
          ui.el('div', { class: 'card-title' }, ['Booked']),
          ui.el('div', { class: 'card-desc' }, [(result.label || formatSlot(result.start)) + ' — see you then.']),
        ])
      );
    } else {
      ui.appendMessage('sentry', (result && result.error) || "That slot didn't go through — let's find another time.");
    }
  }

  function renderScout(ui, result) {
    if (!result) return;
    if (result.available && result.url && ui.isSafeUrl(result.url)) {
      var downloadBtn = ui.el('a', { class: 'btn btn-primary', href: result.url, target: '_blank', rel: 'noopener' }, [
        'Download Scout',
      ]);
      var walkthroughBtn = ui.el('button', { type: 'button', class: 'btn btn-secondary' }, [
        'Have someone walk me through it',
      ]);
      walkthroughBtn.addEventListener('click', function () {
        ui.sendMessage('Can someone walk me through the Scout report with me?');
      });
      ui.appendCardNode(
        ui.el('div', { class: 'card-body' }, [
          ui.el('div', { class: 'card-title' }, ['Scout']),
          ui.el('div', { class: 'card-desc' }, ['A self-serve scan of what AI is actually running in your environment.']),
          ui.el('div', { class: 'card-actions' }, [downloadBtn, walkthroughBtn]),
        ])
      );
    } else {
      ui.appendMessage('sentry', "Scout access is being set up right now — I'll get you the call instead.");
    }
  }

  window.PrivifyChat.createShell({
    rootId: 'privify-sentry-root',
    namespace: 'privify-sentry',
    apiBase: API_BASE,
    page: PAGE,
    cssHref: CSS_HREF,
    markSvg: MARK_SVG,
    title: 'Sentry',
    launcherLabel: 'Ask Sentry',
    placeholder: 'Ask Sentry something…',
    // Retention is named out loud, and must stay in step with
    // TRANSCRIPT_RETENTION_DAYS and the privacy page (addendum 4.3).
    disclosure: 'AI assistant · Conversations are kept 30 days; contact details go to our sales team.',
    privacyUrl: 'https://privify.io/privacy.html',
    contactEmail: (SCRIPT && SCRIPT.dataset.sentryContact) || 'enterprise@privify.io',
    // Microsoft's own Bookings page. The point of the fallback is that it
    // survives our backend being down, so it must not route through us.
    bookingUrl: (SCRIPT && SCRIPT.dataset.sentryBooking) || 'https://outlook.office.com/book/Consult@privify.io/',
    bookingRequest: "I'd like to book a call.",
    greeting: IS_SHIELD
      ? "I'm Sentry, Privify's AI assistant. I can answer questions about SHIELD and get you on the waitlist."
      : "I'm Sentry, Privify's AI assistant. I can answer questions about FORGE and Scout, and book you time with our team.",
    sessionExpiredNotice:
      "That conversation had timed out, so I've started a fresh one — I've lost what we said above, so you may need to recap.",

    /**
     * Which tool cards survive a page navigation.
     *
     * Availability does not: the buttons carry specific times, and by the time
     * someone has read another page those slots may be gone. A restored button
     * would send "Tuesday at 10:30 works for me" for a slot that is taken, and
     * although the conflict guard catches it, the visitor experiences a
     * failure at the exact moment they decided to buy. The times are still in
     * Sentry's message above, and asking for them again re-checks the calendar.
     */
    restoreToolResult: function (tool) {
      return tool !== 'check_availability';
    },

    renderToolResult: function (ui, tool, result) {
      if (tool === 'check_availability') renderAvailability(ui, result);
      else if (tool === 'book_appointment') renderBooking(ui, result);
      else if (tool === 'offer_scout') renderScout(ui, result);
    },
  });
})();
