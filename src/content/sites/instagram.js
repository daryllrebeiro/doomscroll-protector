/** Instagram adapter: Reels is a virtualised pager; DMs are not a feed. */
(function registerInstagram(global) {
  const { registerSiteAdapter, isFullscreenPlayback } = global.MindfulScroll.sites;

  const isReels = () => location.pathname.startsWith('/reels');
  const isDirect = () => location.pathname.startsWith('/direct');

  registerSiteAdapter({
    id: 'instagram',

    // Messaging is conversation, not consumption — don't track or interrupt it.
    isFeedSurface: () => !isDirect(),

    isVirtualFeed: isReels,

    shouldSuppress: () => isFullscreenPlayback() || hasOpenDialog(),

    scrollRoots: () => Array.from(document.querySelectorAll('main, section > div'))
  });

  /** Story viewer / post modal / share sheet all render as role="dialog". */
  function hasOpenDialog() {
    return document.querySelector('div[role="dialog"]') !== null;
  }
})(typeof self !== 'undefined' ? self : globalThis);
