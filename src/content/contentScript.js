/**
 * Mindful Scroll – content script.
 *
 * Thin shell around the pure detector: it turns page events into detector
 * signals, renders the overlay, and talks to the service worker. All heuristic
 * decisions live in detector.js; all site quirks live in sites/*.js.
 */
(() => {
  const {
    MESSAGES,
    STORAGE_KEYS,
    siteIdForHost,
    withDefaults,
    formatDuration,
    t,
    createDetector,
    sites: { adapterFor, isComposing }
  } = window.MindfulScroll;

  const SITE = siteIdForHost(location.hostname);
  if (!SITE) return;

  const adapter = adapterFor(SITE);

  /** Evaluation cadence. Event handlers stay trivial; this does the work. */
  const TICK_MS = 1000;
  /** Only flush accumulated seconds this often, to keep storage writes rare. */
  const FLUSH_EVERY_SECONDS = 60;
  /** Auto-dismiss the overlay if the user never answers (counts as ignored). */
  const OVERLAY_TIMEOUT_MS = 30000;
  /** Keys that advance a virtualised feed (Shorts/Reels) without scrolling. */
  const ADVANCE_KEYS = new Set([
    ' ',
    'Spacebar',
    'ArrowDown',
    'ArrowUp',
    'PageDown',
    'PageUp',
    'j',
    'k'
  ]);

  let settings = withDefaults(null);
  let detector = null;
  let overlayOpen = false;
  let breakUntil = 0;
  let lastUrl = location.href;

  /* ------------------------------------------------------------ messaging */

  async function send(type, payload = {}) {
    try {
      return await chrome.runtime.sendMessage({ type, payload: { site: SITE, ...payload } });
    } catch {
      return null; // extension reloaded / context invalidated
    }
  }

  /** Persist cooldown, break and nudge history so a reload cannot escape them. */
  function persistRuntime() {
    if (!detector) return;
    send(MESSAGES.SET_RUNTIME, { runtime: { ...detector.snapshot(), breakUntil } });
  }

  function flush(force = false) {
    if (!detector) return;
    const entries = detector.takePending(force ? 0 : FLUSH_EVERY_SECONDS);
    if (entries.length) send(MESSAGES.SCROLL_TICK, { entries });
  }

  /* ---------------------------------------------------------- page events */

  const siteEnabled = () => settings.enabled && settings.sites[SITE] !== false;

  /** Cheap by design: the detector only records a timestamp. */
  function onActivity() {
    if (detector) detector.registerActivity();
  }

  function insideOverlay(target) {
    return Boolean(
      (overlayHost && overlayHost.contains(target)) || (breakHost && breakHost.contains(target))
    );
  }

  function onInteraction(event) {
    if (event && insideOverlay(event.target)) return;
    if (detector) detector.registerInteraction();
  }

  function onKeyDown(event) {
    if (overlayOpen && event.key === 'Escape') {
      event.preventDefault();
      handleAction('snooze');
      return;
    }
    // Space/arrows in a feed are scrolling; anything else is real interaction.
    if (ADVANCE_KEYS.has(event.key) && !isComposing()) onActivity();
    else onInteraction(event);
  }

  function checkNavigation() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    if (detector) detector.registerInteraction();
  }

  /* ---------------------------------------------------------------- ticker */

  function tick() {
    if (!detector || !siteEnabled()) return;
    checkNavigation();

    const result = detector.tick({
      hidden: document.hidden,
      feedSurface: adapter.isFeedSurface(),
      suppressed: isSuppressed(),
      overlayOpen
    });

    flush();
    if (result.shouldNudge) showOverlay(result.activeSeconds);
  }

  /** Moments where a nudge would be actively harmful to the experience. */
  function isSuppressed() {
    if (Date.now() < breakUntil) return true;
    if (isComposing()) return true;
    try {
      return adapter.shouldSuppress();
    } catch {
      return false; // a site redesign must never break detection
    }
  }

  /* --------------------------------------------------------------- overlay */

  let overlayHost = null;
  let overlayTimeout = null;
  let previouslyFocused = null;

  function buildOverlay(shadow, scrolledSeconds) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('src/content/overlay.css');

    const card = document.createElement('div');
    card.className = 'ms-card';
    card.setAttribute('role', 'dialog');
    // Not aria-modal: the page stays usable, this is a nudge and not a blocker.
    card.setAttribute('aria-labelledby', 'ms-title');
    card.setAttribute('aria-describedby', 'ms-subtitle');

    const title = document.createElement('h1');
    title.className = 'ms-title';
    title.id = 'ms-title';
    title.textContent = t('overlayTitle', 'You’ve been scrolling for a while. Still intentional?');

    const subtitle = document.createElement('p');
    subtitle.className = 'ms-subtitle';
    subtitle.id = 'ms-subtitle';
    const scrolled = formatDuration(scrolledSeconds);
    subtitle.textContent = t(
      'overlaySubtitle',
      `${scrolled} of continuous scrolling here. Esc snoozes.`,
      [scrolled]
    );

    const actions = document.createElement('div');
    actions.className = 'ms-actions';

    const specs = [
      {
        action: 'break',
        label: t('actionBreak', 'Take a break'),
        className: 'ms-btn ms-btn-primary',
        primary: true
      },
      {
        action: 'continue',
        label: t('actionContinue', 'Continue'),
        className: 'ms-btn ms-btn-ghost'
      },
      {
        action: 'snooze',
        label: t('actionSnooze', 'Remind me later'),
        className: 'ms-btn ms-btn-ghost'
      }
    ];
    const buttons = specs.map((spec) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = spec.className;
      button.textContent = spec.label;
      button.addEventListener('click', () => handleAction(spec.action));
      actions.append(button);
      return button;
    });

    card.append(title, subtitle, actions);
    shadow.append(link, card);
    trapFocus(card, buttons);
    return buttons[0];
  }

  /** Keep Tab cycling inside the card while it is open. */
  function trapFocus(card, buttons) {
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      const active = card.getRootNode().activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  function showOverlay(scrolledSeconds) {
    overlayOpen = true;
    previouslyFocused = document.activeElement;

    overlayHost = document.createElement('div');
    overlayHost.id = 'mindful-scroll-overlay';
    // Host styles are inline so page stylesheets can never move or hide it.
    overlayHost.style.cssText =
      'all: initial; position: fixed; inset: auto 0 24px 0; z-index: 2147483647; display: flex; justify-content: center; pointer-events: none;';
    const shadow = overlayHost.attachShadow({ mode: 'open' });
    const primary = buildOverlay(shadow, scrolledSeconds);
    (document.body || document.documentElement).append(overlayHost);
    primary.focus({ preventScroll: true });

    detector.noteNudgeShown();
    persistRuntime();
    send(MESSAGES.INTERRUPTION_SHOWN);
    overlayTimeout = setTimeout(() => handleAction('ignored'), OVERLAY_TIMEOUT_MS);
  }

  function hideOverlay() {
    clearTimeout(overlayTimeout);
    overlayTimeout = null;
    if (overlayHost) overlayHost.remove();
    overlayHost = null;
    overlayOpen = false;
    if (previouslyFocused && previouslyFocused.isConnected) {
      previouslyFocused.focus({ preventScroll: true });
    }
    previouslyFocused = null;
  }

  async function handleAction(action) {
    hideOverlay();
    if (action === 'break') startBreak();
    detector.applyAction(action);
    flush(true);
    persistRuntime();

    const response = await send(MESSAGES.INTERRUPTION_ACTION, { action });
    if (response && typeof response.ignoredToday === 'number') {
      detector.setIgnoredToday(response.ignoredToday);
    }
  }

  /* ----------------------------------------------------------- break mode */

  let breakHost = null;
  let breakTimer = null;
  let blurStyle = null;

  /** Blur the feed for a while, with a countdown panel on top. */
  function startBreak(endsAt = Date.now() + settings.breakSeconds * 1000) {
    if (breakHost) return;
    breakUntil = endsAt;

    blurStyle = document.createElement('style');
    blurStyle.id = 'mindful-scroll-blur-style';
    blurStyle.textContent =
      'html.mindful-scroll-blurred body { filter: blur(10px) grayscale(0.4) !important; }';
    document.documentElement.append(blurStyle);
    document.documentElement.classList.add('mindful-scroll-blurred');

    breakHost = document.createElement('div');
    breakHost.style.cssText =
      'all: initial; position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center;';
    const shadow = breakHost.attachShadow({ mode: 'open' });

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('src/content/overlay.css');

    const panel = document.createElement('div');
    panel.className = 'ms-break';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', t('breakLabel', 'Break in progress'));

    const heading = document.createElement('h1');
    heading.className = 'ms-title';
    heading.textContent = t('breakTitle', 'Taking a short break');

    const countdown = document.createElement('p');
    countdown.className = 'ms-subtitle';
    countdown.setAttribute('aria-live', 'polite');

    const end = document.createElement('button');
    end.type = 'button';
    end.className = 'ms-btn ms-btn-ghost';
    end.textContent = t('breakEnd', 'End break');
    end.addEventListener('click', endBreak);

    panel.append(heading, countdown, end);
    shadow.append(link, panel);
    (document.body || document.documentElement).append(breakHost);
    end.focus({ preventScroll: true });

    const render = () => {
      const remaining = Math.max(0, Math.round((breakUntil - Date.now()) / 1000));
      const left = formatDuration(remaining);
      countdown.textContent = t('breakCountdown', `Back in ${left}.`, [left]);
      if (remaining <= 0) endBreak();
    };
    render();
    breakTimer = setInterval(render, 1000);
    persistRuntime();
  }

  /** Teardown must be idempotent: an orphaned blur would break the page. */
  function endBreak() {
    clearInterval(breakTimer);
    breakTimer = null;
    if (breakHost) breakHost.remove();
    breakHost = null;
    document.documentElement.classList.remove('mindful-scroll-blurred');
    if (blurStyle) blurStyle.remove();
    blurStyle = null;
    breakUntil = 0;
    persistRuntime();
  }

  /* ------------------------------------------------------------ lifecycle */

  function attachListeners() {
    // Scroll does not bubble, so capture is required to see inner containers
    // (Reddit's shreddit app, Instagram's main, YouTube's Shorts pager).
    document.addEventListener('scroll', onActivity, { capture: true, passive: true });
    for (const type of ['wheel', 'touchmove']) {
      window.addEventListener(type, onActivity, { passive: true, capture: true });
    }

    window.addEventListener('keydown', onKeyDown, true);
    for (const type of ['click', 'submit']) {
      window.addEventListener(type, onInteraction, true);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        detector.registerInteraction();
        flush(true);
        persistRuntime();
      }
    });
    // Persist, but do not tear the break down: breakUntil must survive the
    // reload so the page cannot be refreshed to escape it.
    window.addEventListener('pagehide', () => {
      flush(true);
      persistRuntime();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[STORAGE_KEYS.settings]) return;
      settings = withDefaults(changes[STORAGE_KEYS.settings].newValue);
      detector.setSettings(settings);
      if (!siteEnabled()) {
        hideOverlay();
        endBreak();
        detector.registerInteraction();
      }
    });
  }

  async function init() {
    const context = await send(MESSAGES.GET_CONTEXT);
    settings = withDefaults(context && context.settings);
    const runtime = (context && context.runtime) || {};

    detector = createDetector({
      settings,
      ignoredToday: (context && context.ignoredToday) || 0,
      restored: runtime
    });

    // A reload during a break resumes the break rather than escaping it.
    if (runtime.breakUntil && runtime.breakUntil > Date.now()) startBreak(runtime.breakUntil);

    attachListeners();
    setInterval(tick, TICK_MS);
  }

  init();
})();
