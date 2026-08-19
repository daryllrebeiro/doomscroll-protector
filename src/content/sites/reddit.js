/** Reddit adapter: the shreddit UI scrolls an inner container, not the window. */
(function registerReddit(global) {
  const { registerSiteAdapter, isFullscreenPlayback } = global.MindfulScroll.sites;

  registerSiteAdapter({
    id: 'reddit',

    // Submitting or editing lives under /submit and /edit; not consumption.
    isFeedSurface: () => !/^\/(submit|user\/[^/]+\/submit)/.test(location.pathname),

    shouldSuppress: () => isFullscreenPlayback() || hasOpenDialog(),

    scrollRoots: () =>
      Array.from(document.querySelectorAll('shreddit-app, #main-content, [data-scroller-first]'))
  });

  function hasOpenDialog() {
    return document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') !== null;
  }
})(typeof self !== 'undefined' ? self : globalThis);
