/**
 * Shared constants and helpers.
 *
 * Loaded as a classic script everywhere (content scripts, popup, options) and
 * via `importScripts()` in the service worker, so it must not use ES module
 * syntax. Everything is exposed on `globalThis.MindfulScroll`.
 */
(function attachShared(global) {
  /** Supported sites. `hosts` are matched as hostname suffixes. */
  const SITES = [
    { id: 'twitter', label: 'Twitter / X', hosts: ['twitter.com', 'x.com'] },
    { id: 'reddit', label: 'Reddit', hosts: ['reddit.com'] },
    { id: 'youtube', label: 'YouTube (feed & Shorts)', hosts: ['youtube.com'] },
    { id: 'instagram', label: 'Instagram', hosts: ['instagram.com'] }
  ];

  const DEFAULT_SETTINGS = {
    enabled: true,
    /** Seconds of *active scrolling* before an interruption is considered. */
    scrollThresholdSeconds: 120,
    /** Minutes to stay quiet after "Remind me later". */
    snoozeMinutes: 5,
    /** Seconds to stay quiet after "Continue". */
    cooldownSeconds: 180,
    /** Strict mode: interrupts sooner and stays quiet for less time. */
    strictMode: false,
    /** Adaptive threshold: interrupt sooner when nudges keep getting ignored. */
    adaptiveThreshold: true,
    /** Per-site enable flags. */
    sites: { twitter: true, reddit: true, youtube: true, instagram: true }
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

  /** Local date key (YYYY-MM-DD) used to bucket stats, so days reset naturally. */
  function dateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** Resolve a hostname to a supported site id, or null. */
  function siteIdForHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    const site = SITES.find((s) =>
      s.hosts.some((h) => host === h || host.endsWith(`.${h}`))
    );
    return site ? site.id : null;
  }

  /** Merge stored settings over defaults (one nested level for `sites`). */
  function withDefaults(stored) {
    const merged = { ...DEFAULT_SETTINGS, ...(stored || {}) };
    merged.sites = { ...DEFAULT_SETTINGS.sites, ...((stored && stored.sites) || {}) };
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

  /** "1h 04m" / "4m 20s" / "35s" */
  function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
  }

  global.MindfulScroll = {
    SITES,
    DEFAULT_SETTINGS,
    STORAGE_KEYS,
    MESSAGES,
    ACTIONS,
    STRICT_THRESHOLD_FACTOR,
    STRICT_QUIET_FACTOR,
    ADAPTIVE_STEP,
    ADAPTIVE_MIN_FACTOR,
    dateKey,
    siteIdForHost,
    withDefaults,
    emptyDay,
    formatDuration
  };
})(typeof self !== 'undefined' ? self : globalThis);
