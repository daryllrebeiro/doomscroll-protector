/** YouTube adapter: Shorts advance without scrolling the window. */
(function registerYouTube(global) {
  const { registerSiteAdapter, isFullscreenPlayback } = global.MindfulScroll.sites;

  const isShorts = () => location.pathname.startsWith('/shorts');
  const isWatch = () => location.pathname.startsWith('/watch');

  registerSiteAdapter({
    id: 'youtube',

    // The home/subscriptions feed and Shorts are doomscroll surfaces; a video
    // page only becomes one when the user scrolls comments, which still counts.
    isFeedSurface: () => true,

    // Shorts is a virtualised pager: scrollTop barely moves, so wheel/touch/key
    // "advance" signals are what we count there.
    isVirtualFeed: isShorts,

    shouldSuppress: () =>
      // Never cover a video the user deliberately opened and is watching.
      isFullscreenPlayback() || (isWatch() && isPlayingInline()),

    scrollRoots: () =>
      Array.from(document.querySelectorAll('#contents, ytd-app, #shorts-container')).filter(Boolean)
  });

  function isPlayingInline() {
    const video = document.querySelector('video.html5-main-video, video');
    return Boolean(video && !video.paused && video.currentTime > 0);
  }
})(typeof self !== 'undefined' ? self : globalThis);
