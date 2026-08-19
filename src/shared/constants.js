/**
 * Shared constants and helpers.
 *
 * Loaded as a classic script everywhere (content scripts, popup, options) and
 * via `importScripts()` in the service worker, so it must not use ES module
 * syntax. Everything is exposed on `globalThis.MindfulScroll`.
 */
(function attachShared(global) {
  /**
   * Bump when the persisted shape of `settings` or `stats` changes, and add a
   * matching step in src/shared/migrations.js.
   */
  const SCHEMA_VERSION = 1;

  /** Supported sites. `hosts` are matched as hostname suffixes. */
  const SITES = [
    { id: 'twitter', label: 'Twitter / X', hosts: ['twitter.com', 'x.com'] },
    { id: 'reddit', label: 'Reddit', hosts: ['reddit.com'] },
    { id: 'youtube', label: 'YouTube (feed & Shorts)', hosts: ['youtube.com'] },
    { id: 'instagram', label: 'Instagram', hosts: ['instagram.com'] }
  ];

  const DEFAULT_SETTINGS = {
    schemaVersion: SCHEMA_VERSION,
    enabled: true,
    /** Seconds of *active scrolling* before an interruption is considered. */
    scrollThresholdSeconds: 120,
    /** Minutes to stay quiet after "Remind me later". */
    snoozeMinutes: 5,
    /** Seconds to stay quiet after "Continue". */
    cooldownSeconds: 180,
    /** Length of the blurred break after "Take a break". */
    breakSeconds: 60,
    /** Hard caps so no configuration can produce a nagging loop. */
    maxInterruptionsPerHour: 4,
    minSecondsBetweenInterruptions: 60,
    /** Strict mode: interrupts sooner and stays quiet for less time. */
    strictMode: false,
    /** Adaptive threshold: interrupt sooner when nudges keep getting ignored. */
    adaptiveThreshold: true,
    /** Per-site enable flags. */
    sites: { twitter: true, reddit: true, youtube: true, instagram: true },
    /** Time-based scheduling: auto-enable during specific hours. */
    scheduleEnabled: false,
    scheduleStartHour: 21, // 9 PM
    scheduleEndHour: 1 // 1 AM (next day)
  };

  const STORAGE_KEYS = {
    settings: 'settings',
    stats: 'stats'
  };

  const MESSAGES = {
    GET_SETTINGS: 'GET_SETTINGS',
    SAVE_SETTINGS: 'SAVE_SETTINGS',
    GET_STATS: 'GET_STATS',
    RESET_STATS: 'RESET_STATS',
    EXPORT_DATA: 'EXPORT_DATA',
    IMPORT_DATA: 'IMPORT_DATA',
    DELETE_ALL_DATA: 'DELETE_ALL_DATA',
    /** One round-trip on injection: settings + ignored count + runtime state. */
    GET_CONTEXT: 'GET_CONTEXT',
    /** Persist per-tab runtime state (cooldown, break, nudge history). */
    SET_RUNTIME: 'SET_RUNTIME',
    SCROLL_TICK: 'SCROLL_TICK',
    INTERRUPTION_SHOWN: 'INTERRUPTION_SHOWN',
    INTERRUPTION_ACTION: 'INTERRUPTION_ACTION'
  };

  /** Actions a user can take on the overlay. */
  const ACTIONS = ['continue', 'break', 'snooze', 'ignored'];

  /** Strict mode multipliers applied to the configured threshold / quiet time. */
  const STRICT_THRESHOLD_FACTOR = 0.6;
  const STRICT_QUIET_FACTOR = 0.5;

  /** Adaptive threshold bounds. */
  const ADAPTIVE_STEP = 0.85;
  const ADAPTIVE_MIN_FACTOR = 0.5;

  /** Never nudge below this, whatever strict/adaptive multipliers work out to. */
  const MIN_THRESHOLD_SECONDS = 20;

  /** Days of daily history to keep; older buckets are pruned on write. */
  const HISTORY_DAYS = 14;

  /** Local date key (YYYY-MM-DD) used to bucket stats, so days reset naturally. */
  function dateKey(date = new Date()) {
    const value = date instanceof Date ? date : new Date(date);
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** Resolve a hostname to a supported site id, or null. */
  function siteIdForHost(hostname) {
    const host = String(hostname || '')
      .toLowerCase()
      .replace(/\.$/, '');
    const site = SITES.find((s) => s.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
    return site ? site.id : null;
  }

  /** Merge stored settings over defaults (one nested level for `sites`). */
  function withDefaults(stored) {
    const source = stored && typeof stored === 'object' ? stored : {};
    const merged = { ...DEFAULT_SETTINGS, ...source };

    // Numeric fields can arrive as strings from <select>, or as garbage from a
    // hand-edited storage entry; coerce and fall back to the default.
    for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
      if (typeof fallback !== 'number') continue;
      const value = Number(merged[key]);
      merged[key] = Number.isFinite(value) && value > 0 ? value : fallback;
    }
    for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
      if (typeof fallback !== 'boolean') continue;
      merged[key] = Boolean(merged[key]);
    }

    const sites = source.sites && typeof source.sites === 'object' ? source.sites : {};
    merged.sites = { ...DEFAULT_SETTINGS.sites };
    for (const site of SITES) {
      if (site.id in sites) merged.sites[site.id] = sites[site.id] !== false;
    }
    merged.schemaVersion = SCHEMA_VERSION;
    return merged;
  }

  /** Empty stats bucket for a single day. */
  function emptyDay() {
    return {
      scrollSeconds: 0,
      interruptions: 0,
      actions: { continue: 0, break: 0, snooze: 0, ignored: 0 },
      perSite: {}
    };
  }

  /** Normalise a possibly-partial stored day bucket into a complete one. */
  function normaliseDay(day) {
    const base = emptyDay();
    const source = day && typeof day === 'object' ? day : {};
    return {
      scrollSeconds: Number(source.scrollSeconds) || 0,
      interruptions: Number(source.interruptions) || 0,
      actions: { ...base.actions, ...(source.actions || {}) },
      perSite: { ...(source.perSite || {}) }
    };
  }

  /** Nudges that changed nothing: explicit "Continue" plus auto-dismissals. */
  function ignoredCount(day) {
    const actions = normaliseDay(day).actions;
    return (actions.continue || 0) + (actions.ignored || 0);
  }

  /**
   * Localised string lookup. `fallback` is the English source text, which keeps
   * the code readable and keeps everything working outside an extension context
   * (unit tests, and any locale whose catalogue is missing a key).
   *
   * @param {string} key
   * @param {string} fallback
   * @param {string[]} [substitutions]
   */
  function t(key, fallback, substitutions = []) {
    const i18n = global.chrome && global.chrome.i18n;
    const message = i18n && i18n.getMessage ? i18n.getMessage(key, substitutions) : '';
    return message || fallback;
  }

  /** "1h 04m" / "4m 20s" / "35s" */
  function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
    const h = String(Math.floor(seconds / 3600));
    const m = String(Math.floor((seconds % 3600) / 60));
    const s = String(seconds % 60);
    const pad = (value) => value.padStart(2, '0');
    if (Number(h) > 0) return t('durationHours', `${h}h ${pad(m)}m`, [h, pad(m)]);
    if (Number(m) > 0) return t('durationMinutes', `${m}m ${pad(s)}s`, [m, pad(s)]);
    return t('durationSeconds', `${s}s`, [s]);
  }

  /**
   * Effective threshold in seconds.
   * Strict mode shortens it; the adaptive heuristic shortens it further for each
   * nudge ignored today, floored so it can never become a nag.
   */
  function thresholdSeconds(settings, ignoredToday = 0) {
    const config = withDefaults(settings);
    let seconds = config.scrollThresholdSeconds;
    if (config.strictMode) seconds *= STRICT_THRESHOLD_FACTOR;
    if (config.adaptiveThreshold && ignoredToday > 0) {
      seconds *= Math.max(ADAPTIVE_MIN_FACTOR, Math.pow(ADAPTIVE_STEP, ignoredToday));
    }
    return Math.max(MIN_THRESHOLD_SECONDS, Math.round(seconds));
  }

  /** Quiet period (ms) applied after each overlay action. */
  function quietMsForAction(settings, action) {
    const config = withDefaults(settings);
    const factor = config.strictMode ? STRICT_QUIET_FACTOR : 1;
    if (action === 'snooze') return config.snoozeMinutes * 60000 * factor;
    if (action === 'break') return (config.breakSeconds + config.cooldownSeconds) * 1000 * factor;
    return config.cooldownSeconds * 1000 * factor;
  }

  global.MindfulScroll = {
    SCHEMA_VERSION,
    SITES,
    DEFAULT_SETTINGS,
    STORAGE_KEYS,
    MESSAGES,
    ACTIONS,
    STRICT_THRESHOLD_FACTOR,
    STRICT_QUIET_FACTOR,
    ADAPTIVE_STEP,
    ADAPTIVE_MIN_FACTOR,
    MIN_THRESHOLD_SECONDS,
    HISTORY_DAYS,
    dateKey,
    siteIdForHost,
    withDefaults,
    emptyDay,
    normaliseDay,
    ignoredCount,
    t,
    formatDuration,
    thresholdSeconds,
    quietMsForAction
  };
})(typeof self !== 'undefined' ? self : globalThis);
