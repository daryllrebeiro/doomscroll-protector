/** Twitter / X adapter: plain window scrolling, with composer + media suppression. */
(function registerTwitter(global) {
  const { registerSiteAdapter, isFullscreenPlayback } = global.MindfulScroll.sites;

  registerSiteAdapter({
    id: 'twitter',

    // /messages and /compose are interaction surfaces, not feeds.
    isFeedSurface: () =>
      !location.pathname.startsWith('/messages') && !location.pathname.startsWith('/compose'),

    shouldSuppress: () => isFullscreenPlayback() || hasOpenDialog(),

    scrollRoots: () => Array.from(document.querySelectorAll('main, [data-testid="primaryColumn"]'))
  });

  /** Tweet composer and the photo lightbox both use aria-modal dialogs. */
  function hasOpenDialog() {
    return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
  }
})(typeof self !== 'undefined' ? self : globalThis);
