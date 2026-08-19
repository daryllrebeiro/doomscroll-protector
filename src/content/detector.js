/**
 * Doomscroll detector: a pure state machine.
 *
 * It owns *all* of the heuristic (what counts as active scrolling, when to
 * nudge, when to stay quiet) and touches neither the DOM nor chrome APIs, so it
 * can be unit-tested with a fake clock. contentScript.js feeds it events and
 * renders whatever it decides.
 *
 * Classic script; exposed as MindfulScroll.createDetector.
 */
(function attachDetector(global) {
  const { dateKey, thresholdSeconds, quietMsForAction, withDefaults } = global.MindfulScroll;

  /** Max gap between activity signals that still counts as "continuous". */
  const IDLE_GAP_MS = 2000;
  /** Idle longer than this and the run is over: the accumulator resets. */
  const RESET_AFTER_IDLE_MS = 6000;
  /** Upper bound on the time credited by a single tick (throttled timers). */
  const MAX_TICK_MS = 5000;
  /** Window used by the interruptions-per-hour cap. */
  const HOUR_MS = 3600000;

  /**
   * @param {object} options
   * @param {object} options.settings
   * @param {() => number} [options.now]        Injectable clock (ms).
   * @param {number} [options.ignoredToday]     Nudges ignored today, for the adaptive threshold.
   * @param {object} [options.restored]         Runtime state recovered from storage.session.
   */
  function createDetector({ settings, now = () => Date.now(), ignoredToday = 0, restored = {} }) {
    let config = withDefaults(settings);
    let ignored = Number(ignoredToday) || 0;

    let activeSeconds = Number(restored.activeSeconds) || 0;
    let quietUntil = Number(restored.quietUntil) || 0;
    /** Timestamps of recent nudges, for the per-hour cap. */
    let nudgeHistory = Array.isArray(restored.nudgeHistory) ? restored.nudgeHistory.slice() : [];

    let lastActivityAt = 0;
    let lastTickAt = now();
    /** dateKey -> seconds not yet reported to the background. */
    let pending = new Map();

    function creditTime(seconds, timestamp) {
      const key = dateKey(new Date(timestamp));
      pending.set(key, (pending.get(key) || 0) + seconds);
    }

    function withinFrequencyCap(timestamp) {
      nudgeHistory = nudgeHistory.filter((at) => timestamp - at < HOUR_MS);
      if (nudgeHistory.length >= config.maxInterruptionsPerHour) return false;
      const last = nudgeHistory[nudgeHistory.length - 1];
      if (last && timestamp - last < config.minSecondsBetweenInterruptions * 1000) return false;
      return true;
    }

    return {
      /** Replace settings live (options page saved, site toggled). */
      setSettings(next) {
        config = withDefaults(next);
      },

      setIgnoredToday(count) {
        ignored = Number(count) || 0;
      },

      /** Current effective threshold, after strict + adaptive multipliers. */
      thresholdSeconds() {
        return thresholdSeconds(config, ignored);
      },

      /** Continuous-scrolling seconds accumulated in the current run. */
      get activeSeconds() {
        return activeSeconds;
      },

      get quietUntil() {
        return quietUntil;
      },

      /** Serialisable state to persist across reloads / worker restarts. */
      snapshot() {
        return { activeSeconds, quietUntil, nudgeHistory: nudgeHistory.slice() };
      },

      /**
       * A scroll or feed-advance signal. Deliberately cheap: the handler that
       * calls this must do nothing else.
       */
      registerActivity(timestamp = now()) {
        lastActivityAt = timestamp;
      },

      /**
       * Meaningful interaction (click, keypress, submit) or navigation: the
       * user is doing something, so the current run does not count.
       */
      registerInteraction() {
        activeSeconds = 0;
        lastActivityAt = 0;
      },

      reset() {
        activeSeconds = 0;
        lastActivityAt = 0;
      },

      /**
       * Advance the state machine.
       * @param {object} context
       * @param {boolean} context.hidden      Tab not visible.
       * @param {boolean} context.feedSurface Current URL is a trackable feed.
       * @param {boolean} context.suppressed  Overlay must not be shown right now.
       * @param {boolean} context.overlayOpen An overlay is already on screen.
       * @returns {{ activeSeconds: number, shouldNudge: boolean, deferred: boolean }}
       */
      tick(context = {}) {
        const timestamp = now();
        const elapsedMs = Math.min(Math.max(timestamp - lastTickAt, 0), MAX_TICK_MS);
        lastTickAt = timestamp;

        if (context.hidden || !context.feedSurface) {
          this.reset();
          return { activeSeconds, shouldNudge: false, deferred: false };
        }

        const sinceActivity = timestamp - lastActivityAt;
        if (sinceActivity > IDLE_GAP_MS) {
          if (sinceActivity > RESET_AFTER_IDLE_MS) this.reset();
          return { activeSeconds, shouldNudge: false, deferred: false };
        }

        const seconds = elapsedMs / 1000;
        activeSeconds += seconds;
        creditTime(seconds, timestamp);

        const ready =
          !context.overlayOpen &&
          timestamp >= quietUntil &&
          activeSeconds >= thresholdSeconds(config, ignored);

        if (!ready) return { activeSeconds, shouldNudge: false, deferred: false };

        // Ready, but the moment is wrong (fullscreen video, typing, modal) or
        // we have nudged too often: hold the accumulated time and try later.
        if (context.suppressed || !withinFrequencyCap(timestamp)) {
          return { activeSeconds, shouldNudge: false, deferred: true };
        }

        return { activeSeconds, shouldNudge: true, deferred: false };
      },

      /** Record that a nudge was shown (feeds the per-hour cap). */
      noteNudgeShown(timestamp = now()) {
        nudgeHistory.push(timestamp);
        nudgeHistory = nudgeHistory.filter((at) => timestamp - at < HOUR_MS);
      },

      /** Apply the quiet period for an overlay action and end the current run. */
      applyAction(action, timestamp = now()) {
        quietUntil = timestamp + quietMsForAction(config, action);
        this.reset();
        return quietUntil;
      },

      /** Force a quiet period (used when a break is restored after reload). */
      setQuietUntil(timestamp) {
        quietUntil = Number(timestamp) || 0;
      },

      /**
       * Hand over accumulated seconds for reporting, oldest day first.
       * @param {number} [minSeconds] Only flush once this much has accrued.
       * @returns {{ date: string, seconds: number }[]}
       */
      takePending(minSeconds = 0) {
        let total = 0;
        for (const seconds of pending.values()) total += seconds;
        if (total < minSeconds || total <= 0) return [];

        const entries = Array.from(pending, ([date, seconds]) => ({ date, seconds }));
        entries.sort((a, b) => (a.date < b.date ? -1 : 1));
        pending = new Map();
        return entries;
      }
    };
  }

  global.MindfulScroll.createDetector = createDetector;
  global.MindfulScroll.detectorConstants = { IDLE_GAP_MS, RESET_AFTER_IDLE_MS, MAX_TICK_MS };
})(typeof self !== 'undefined' ? self : globalThis);
