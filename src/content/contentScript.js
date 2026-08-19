/**
 * Mindful Scroll – content script.
 *
 * Runs in the page context on supported sites and:
 *  - measures *active* scrolling time (cheap: the scroll handler only stores a
 *    timestamp; all evaluation happens in a 1s interval tick)
 *  - resets the accumulator on meaningful interaction or navigation
 *  - shows the interruption overlay (in a shadow root, so page CSS can't leak in)
 *  - reports events to the background service worker
 */
(() => {
  const {
    MESSAGES,
    STORAGE_KEYS,
    STRICT_THRESHOLD_FACTOR,
    STRICT_QUIET_FACTOR,
    ADAPTIVE_STEP,
    ADAPTIVE_MIN_FACTOR,
    siteIdForHost,
    withDefaults,
    formatDuration
  } = window.MindfulScroll;

  const SITE = siteIdForHost(location.hostname);
  if (!SITE) return;

  /** Max gap between scroll events that still counts as "continuous". */
  const IDLE_GAP_MS = 2000;
  /** Evaluation cadence. Scroll handler stays trivial; this does the work. */
  const TICK_MS = 1000;
  /** Seconds of accumulated scrolling reported to the background at a time. */
  const REPORT_EVERY_SECONDS = 10;
  /** Auto-dismiss the overlay if the user never answers (counts as ignored). */
  const OVERLAY_TIMEOUT_MS = 30000;
  /** How long "Take a break" blurs the feed. */
  const BREAK_MS = 60000;

  const state = {
    settings: withDefaults(null),
    /** Seconds of continuous scrolling since the last reset. */
    activeSeconds: 0,
    /** Seconds not yet reported to the background. */
    unreportedSeconds: 0,
    lastScrollAt: 0,
    lastScrollY: window.scrollY,
    /** Timestamp until which we stay quiet (cooldown / snooze / break). */
    quietUntil: 0,
    overlayOpen: false,
    ignoredToday: 0,
    lastUrl: location.href,
    tickTimer: null
  };

  /* -------------------------------------------------------- configuration */

  function siteEnabled() {
    return state.settings.enabled && state.settings.sites[SITE] !== false;
  }

  /**
   * Effective threshold in seconds.
   * Strict mode shortens it; the adaptive heuristic shortens it further each
   * time a nudge is ignored today (floored at ADAPTIVE_MIN_FACTOR).
   */
  function thresholdSeconds() {
    let seconds = Number(state.settings.scrollThresholdSeconds) || 120;
    if (state.settings.strictMode) seconds *= STRICT_THRESHOLD_FACTOR;
    if (state.settings.adaptiveThreshold && state.ignoredToday > 0) {
      const factor = Math.max(
        ADAPTIVE_MIN_FACTOR,
        Math.pow(ADAPTIVE_STEP, state.ignoredToday)
      );
      seconds *= factor;
    }
    return Math.max(20, Math.round(seconds));
  }

  function quietFactor() {
    return state.settings.strictMode ? STRICT_QUIET_FACTOR : 1;
  }

  /* ------------------------------------------------------------ messaging */

  async function send(type, payload = {}) {
    try {
      return await chrome.runtime.sendMessage({ type, payload: { site: SITE, ...payload } });
    } catch {
      return null; // extension reloaded / context invalidated
    }
  }

  async function loadSettings() {
    const response = await send(MESSAGES.GET_SETTINGS);
    if (response && response.settings) state.settings = response.settings;
  }

  async function loadIgnoredCount() {
    const response = await send(MESSAGES.GET_STATS);
    if (response && response.today) {
      const actions = response.today.actions || {};
      state.ignoredToday = (actions.continue || 0) + (actions.ignored || 0);
    }
  }

  function flushScrollTime(force = false) {
    if (state.unreportedSeconds >= REPORT_EVERY_SECONDS || (force && state.unreportedSeconds > 0)) {
      const seconds = state.unreportedSeconds;
      state.unreportedSeconds = 0;
      send(MESSAGES.SCROLL_TICK, { seconds });
    }
  }

  /* ------------------------------------------------------- scroll tracking */

  function onScroll() {
    // Intentionally trivial – no layout reads beyond scrollY, no DOM work.
    state.lastScrollAt = Date.now();
  }

  function resetAccumulator(reason) {
    if (state.activeSeconds > 0) flushScrollTime(true);
    state.activeSeconds = 0;
    state.lastScrollAt = 0;
    void reason;
  }

  /** Meaningful interaction = the user is doing something, not just consuming. */
  function onMeaningfulInteraction(event) {
    if (state.overlayOpen && overlayHost && event && overlayHost.contains(event.target)) return;
    resetAccumulator('interaction');
  }

  function checkNavigation() {
    if (location.href !== state.lastUrl) {
      state.lastUrl = location.href;
      resetAccumulator('navigation');
    }
  }

  function tick() {
    if (!siteEnabled() || document.hidden) {
      if (document.hidden) resetAccumulator('hidden');
      return;
    }
    checkNavigation();

    const scrolledRecently = Date.now() - state.lastScrollAt <= IDLE_GAP_MS;
    if (!scrolledRecently) {
      if (state.activeSeconds > 0 && Date.now() - state.lastScrollAt > IDLE_GAP_MS * 3) {
        resetAccumulator('idle');
      }
      flushScrollTime();
      return;
    }

    state.activeSeconds += TICK_MS / 1000;
    state.unreportedSeconds += TICK_MS / 1000;
    flushScrollTime();

    if (
      !state.overlayOpen &&
      Date.now() >= state.quietUntil &&
      state.activeSeconds >= thresholdSeconds()
    ) {
      showOverlay(state.activeSeconds);
    }
  }

  /* --------------------------------------------------------------- overlay */

  let overlayHost = null;
  let overlayTimeout = null;

  function buildOverlay(shadow, scrolledSeconds) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('src/content/overlay.css');

    const card = document.createElement('div');
    card.className = 'ms-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-live', 'polite');
    card.setAttribute('aria-label', 'Mindful Scroll check-in');

    const title = document.createElement('h1');
    title.className = 'ms-title';
    title.textContent = 'You’ve been scrolling for a while. Still intentional?';

    const subtitle = document.createElement('p');
    subtitle.className = 'ms-subtitle';
    subtitle.textContent = `${formatDuration(scrolledSeconds)} of continuous scrolling here.`;

    const actions = document.createElement('div');
    actions.className = 'ms-actions';

    const buttons = [
      { action: 'continue', label: 'Continue', className: 'ms-btn ms-btn-ghost' },
      { action: 'break', label: 'Take a break', className: 'ms-btn ms-btn-primary' },
      { action: 'snooze', label: 'Remind me later', className: 'ms-btn ms-btn-ghost' }
    ];
    for (const spec of buttons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = spec.className;
      button.textContent = spec.label;
      button.addEventListener('click', () => handleAction(spec.action));
      actions.append(button);
    }

    card.append(title, subtitle, actions);
    shadow.append(link, card);
  }

  function showOverlay(scrolledSeconds) {
    state.overlayOpen = true;

    overlayHost = document.createElement('div');
    overlayHost.id = 'mindful-scroll-overlay';
    // Host styles live inline so the page's stylesheets can never override them.
    overlayHost.style.cssText =
      'all: initial; position: fixed; inset: auto 0 24px 0; z-index: 2147483647; display: flex; justify-content: center; pointer-events: none;';
    const shadow = overlayHost.attachShadow({ mode: 'open' });
    buildOverlay(shadow, scrolledSeconds);
    (document.body || document.documentElement).append(overlayHost);

    send(MESSAGES.INTERRUPTION_SHOWN);
    overlayTimeout = setTimeout(() => handleAction('ignored'), OVERLAY_TIMEOUT_MS);
  }

  function hideOverlay() {
    clearTimeout(overlayTimeout);
    overlayTimeout = null;
    if (overlayHost) overlayHost.remove();
    overlayHost = null;
    state.overlayOpen = false;
  }

  async function handleAction(action) {
    hideOverlay();
    resetAccumulator('overlay-action');

    const cooldownMs = (Number(state.settings.cooldownSeconds) || 180) * 1000 * quietFactor();
    const snoozeMs = (Number(state.settings.snoozeMinutes) || 5) * 60000;

    if (action === 'break') {
      startBreak();
      state.quietUntil = Date.now() + BREAK_MS + cooldownMs;
    } else if (action === 'snooze') {
      state.quietUntil = Date.now() + snoozeMs;
    } else {
      // "continue" and auto-dismiss: short cooldown so we don't nag.
      state.quietUntil = Date.now() + cooldownMs;
    }

    const response = await send(MESSAGES.INTERRUPTION_ACTION, { action });
    if (response && typeof response.ignoredToday === 'number') {
      state.ignoredToday = response.ignoredToday;
    }
  }

  /* ----------------------------------------------------------- break mode */

  let breakHost = null;
  let breakTimer = null;

  /** Blur the feed for a minute with a small "come back later" panel on top. */
  function startBreak() {
    if (breakHost) return;
    document.documentElement.classList.add('mindful-scroll-blurred');

    const style = document.createElement('style');
    style.id = 'mindful-scroll-blur-style';
    style.textContent =
      'html.mindful-scroll-blurred body { filter: blur(10px) grayscale(0.4) !important; transition: filter 300ms ease; }';
    document.documentElement.append(style);

    breakHost = document.createElement('div');
    breakHost.style.cssText =
      'all: initial; position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center;';
    const shadow = breakHost.attachShadow({ mode: 'open' });

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('src/content/overlay.css');

    const panel = document.createElement('div');
    panel.className = 'ms-break';

    const heading = document.createElement('h1');
    heading.className = 'ms-title';
    heading.textContent = 'Taking a short break';

    const countdown = document.createElement('p');
    countdown.className = 'ms-subtitle';

    const end = document.createElement('button');
    end.type = 'button';
    end.className = 'ms-btn ms-btn-ghost';
    end.textContent = 'End break';
    end.addEventListener('click', endBreak);

    panel.append(heading, countdown, end);
    shadow.append(link, panel);
    (document.body || document.documentElement).append(breakHost);

    const endsAt = Date.now() + BREAK_MS;
    const render = () => {
      const remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      countdown.textContent = `Back in ${formatDuration(remaining)}.`;
      if (remaining <= 0) endBreak();
    };
    render();
    breakTimer = setInterval(render, 1000);
  }

  function endBreak() {
    clearInterval(breakTimer);
    breakTimer = null;
    if (breakHost) breakHost.remove();
    breakHost = null;
    document.documentElement.classList.remove('mindful-scroll-blurred');
    const style = document.getElementById('mindful-scroll-blur-style');
    if (style) style.remove();
  }

  /* ------------------------------------------------------------ lifecycle */

  function start() {
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', onScroll, { passive: true });
    window.addEventListener('touchmove', onScroll, { passive: true });

    for (const type of ['click', 'keydown', 'submit']) {
      window.addEventListener(type, onMeaningfulInteraction, true);
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) resetAccumulator('hidden');
    });
    window.addEventListener('pagehide', () => flushScrollTime(true));

    state.tickTimer = setInterval(tick, TICK_MS);

    // React to settings changes without needing a page reload.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[STORAGE_KEYS.settings]) {
        state.settings = withDefaults(changes[STORAGE_KEYS.settings].newValue);
        if (!siteEnabled()) {
          hideOverlay();
          endBreak();
          resetAccumulator('disabled');
        }
      }
    });
  }

  Promise.all([loadSettings(), loadIgnoredCount()]).then(start);
})();
