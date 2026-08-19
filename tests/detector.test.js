import { beforeEach, describe, expect, it } from 'vitest';
import { MS } from './setup.js';

const { createDetector, dateKey } = MS;

// Threshold has to stay above MIN_THRESHOLD_SECONDS or the clamp, not the
// setting, decides when a nudge fires.
const SETTINGS = {
  scrollThresholdSeconds: 30,
  cooldownSeconds: 300,
  snoozeMinutes: 10,
  breakSeconds: 5,
  maxInterruptionsPerHour: 4,
  minSecondsBetweenInterruptions: 60,
  strictMode: false,
  adaptiveThreshold: false
};

const CONTEXT = { hidden: false, feedSurface: true, suppressed: false, overlayOpen: false };

/** Fake clock so a two-minute scenario runs instantly and deterministically. */
function makeClock(start = new Date(2026, 5, 1, 12, 0, 0).getTime()) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
      return current;
    }
  };
}

/** Scroll continuously for `seconds`, ticking once a second. */
function scrollFor(detector, clock, seconds, context = CONTEXT) {
  let last = null;
  for (let i = 0; i < seconds; i += 1) {
    detector.registerActivity();
    clock.advance(1000);
    last = detector.tick(context);
  }
  return last;
}

describe('detector', () => {
  let clock;
  let detector;

  beforeEach(() => {
    clock = makeClock();
    detector = createDetector({ settings: SETTINGS, now: clock.now });
  });

  it('accumulates active seconds only while scrolling continuously', () => {
    scrollFor(detector, clock, 5);
    expect(detector.activeSeconds).toBeCloseTo(5, 5);
  });

  it('nudges once the threshold is crossed', () => {
    const before = scrollFor(detector, clock, 29);
    expect(before.shouldNudge).toBe(false);
    const at = scrollFor(detector, clock, 1);
    expect(at.shouldNudge).toBe(true);
  });

  it('does not count reading: idle gaps stop accumulation and eventually reset', () => {
    scrollFor(detector, clock, 5);
    clock.advance(3000); // past the 2s gap but under the reset window
    expect(detector.tick(CONTEXT).shouldNudge).toBe(false);
    expect(detector.activeSeconds).toBeCloseTo(5, 5);

    clock.advance(8000); // past the reset window
    detector.tick(CONTEXT);
    expect(detector.activeSeconds).toBe(0);
  });

  it('resets on meaningful interaction', () => {
    scrollFor(detector, clock, 25);
    detector.registerInteraction();
    expect(detector.activeSeconds).toBe(0);
    expect(scrollFor(detector, clock, 20).shouldNudge).toBe(false);
  });

  it('does not accumulate while the tab is hidden or off a feed surface', () => {
    scrollFor(detector, clock, 5, { ...CONTEXT, hidden: true });
    expect(detector.activeSeconds).toBe(0);
    scrollFor(detector, clock, 5, { ...CONTEXT, feedSurface: false });
    expect(detector.activeSeconds).toBe(0);
  });

  it('credits at most MAX_TICK_MS when timers are throttled', () => {
    detector.registerActivity();
    clock.advance(60000); // background throttling: one tick, a minute later
    detector.registerActivity();
    detector.tick(CONTEXT);
    expect(detector.activeSeconds).toBeLessThanOrEqual(5);
  });

  it('defers instead of dropping when the moment is suppressed', () => {
    const result = scrollFor(detector, clock, 35, { ...CONTEXT, suppressed: true });
    expect(result).toMatchObject({ shouldNudge: false, deferred: true });

    // Once the video ends / the composer closes, the held time still fires.
    expect(scrollFor(detector, clock, 1).shouldNudge).toBe(true);
  });

  it('stays quiet for the cooldown after Continue', () => {
    // Frequency cap relaxed so this exercises the cooldown alone.
    const relaxed = createDetector({
      settings: { ...SETTINGS, minSecondsBetweenInterruptions: 1 },
      now: clock.now
    });
    scrollFor(relaxed, clock, 30);
    relaxed.noteNudgeShown();
    relaxed.applyAction('continue');

    expect(scrollFor(relaxed, clock, 35).shouldNudge).toBe(false);

    clock.advance(300000); // cooldown expires
    expect(scrollFor(relaxed, clock, 35).shouldNudge).toBe(true);
  });

  it('stays quiet for the snooze period, which is longer than the cooldown', () => {
    detector.applyAction('snooze');
    clock.advance(300000); // a full cooldown later, snooze still holds
    expect(scrollFor(detector, clock, 35).shouldNudge).toBe(false);
    clock.advance(600000);
    expect(scrollFor(detector, clock, 35).shouldNudge).toBe(true);
  });

  it('enforces a minimum gap between nudges even with a zero cooldown', () => {
    const impatient = createDetector({
      settings: { ...SETTINGS, cooldownSeconds: 1 },
      now: clock.now
    });
    scrollFor(impatient, clock, 30);
    impatient.noteNudgeShown();
    impatient.applyAction('continue');

    clock.advance(2000); // cooldown gone, but under minSecondsBetweenInterruptions
    const result = scrollFor(impatient, clock, 35);
    expect(result).toMatchObject({ shouldNudge: false, deferred: true });
  });

  it('caps nudges per hour', () => {
    const spammy = createDetector({
      settings: { ...SETTINGS, cooldownSeconds: 1, minSecondsBetweenInterruptions: 1 },
      now: clock.now
    });
    for (let i = 0; i < 4; i += 1) {
      const result = scrollFor(spammy, clock, 35);
      expect(result.shouldNudge).toBe(true);
      spammy.noteNudgeShown();
      spammy.applyAction('continue');
      clock.advance(5000);
    }
    expect(scrollFor(spammy, clock, 35)).toMatchObject({ shouldNudge: false, deferred: true });

    clock.advance(3600001); // the hour window slides
    expect(scrollFor(spammy, clock, 35).shouldNudge).toBe(true);
  });

  it('shortens the threshold as nudges are ignored when adaptive is on', () => {
    const adaptive = createDetector({
      settings: { ...SETTINGS, adaptiveThreshold: true, scrollThresholdSeconds: 100 },
      now: clock.now
    });
    expect(adaptive.thresholdSeconds()).toBe(100);
    adaptive.setIgnoredToday(3);
    expect(adaptive.thresholdSeconds()).toBe(61);
  });

  it('restores cooldown and nudge history from a snapshot', () => {
    scrollFor(detector, clock, 30);
    detector.noteNudgeShown();
    detector.applyAction('continue');
    const snapshot = detector.snapshot();

    // Simulate a page reload: a fresh detector seeded with the stored runtime.
    const revived = createDetector({ settings: SETTINGS, now: clock.now, restored: snapshot });
    expect(scrollFor(revived, clock, 35).shouldNudge).toBe(false);
  });

  describe('pending time', () => {
    it('withholds until the flush threshold is reached', () => {
      scrollFor(detector, clock, 5);
      expect(detector.takePending(60)).toEqual([]);
      expect(detector.takePending(0)).toEqual([
        { date: dateKey(new Date(clock.now())), seconds: 5 }
      ]);
      expect(detector.takePending(0)).toEqual([]); // drained
    });

    it('attributes seconds to the day they accrued in across midnight', () => {
      const midnight = makeClock(new Date(2026, 5, 1, 23, 59, 58).getTime());
      const nightOwl = createDetector({ settings: SETTINGS, now: midnight.now });
      scrollFor(nightOwl, midnight, 4);

      expect(nightOwl.takePending(0)).toEqual([
        { date: '2026-06-01', seconds: 1 },
        { date: '2026-06-02', seconds: 3 }
      ]);
    });
  });
});
