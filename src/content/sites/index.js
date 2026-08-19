/**
 * Site adapter registry.
 *
 * Each supported site gets an adapter so its quirks (inner scroll containers,
 * virtualised feeds that never change scrollTop, fullscreen players, composer
 * modals) live in exactly one file. Anything an adapter does not override falls
 * back to DEFAULT_ADAPTER, which is the plain window-scroll behaviour — so when
 * a site ships a redesign the extension degrades instead of breaking.
 *
 * Classic script; loaded before the per-site adapters and contentScript.js.
 */
(function attachSiteRegistry(global) {
  const adapters = new Map();

  /**
   * @typedef {object} SiteAdapter
   * @property {string} id
   * @property {() => boolean} [isFeedSurface]   Is the current URL a scrollable feed?
   * @property {() => boolean} [isVirtualFeed]   Feed that advances without scrollTop change (Shorts/Reels).
   * @property {() => boolean} [shouldSuppress]  Suppress the overlay right now (fullscreen, modal, ...).
   * @property {() => Element[]} [scrollRoots]   Inner containers, for diagnostics.
   */

  const DEFAULT_ADAPTER = {
    id: 'default',
    isFeedSurface: () => true,
    isVirtualFeed: () => false,
    shouldSuppress: () => false,
    scrollRoots: () => []
  };

  /** True when any element is in fullscreen, or a video is playing full-viewport. */
  function isFullscreenPlayback() {
    if (document.fullscreenElement) return true;
    const video = document.querySelector('video');
    if (!video || video.paused) return false;
    const rect = video.getBoundingClientRect();
    return rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.8;
  }

  /** True when the user is typing somewhere — never interrupt composition. */
  function isComposing() {
    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    if (!active) return false;
    const tag = active.tagName;
    return (
      tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable === true
    );
  }

  function registerSiteAdapter(adapter) {
    adapters.set(adapter.id, { ...DEFAULT_ADAPTER, ...adapter });
  }

  /** Adapter for a site id, always returning a complete adapter. */
  function adapterFor(siteId) {
    return adapters.get(siteId) || { ...DEFAULT_ADAPTER, id: siteId || 'default' };
  }

  global.MindfulScroll.sites = {
    DEFAULT_ADAPTER,
    registerSiteAdapter,
    adapterFor,
    isFullscreenPlayback,
    isComposing
  };
})(typeof self !== 'undefined' ? self : globalThis);
