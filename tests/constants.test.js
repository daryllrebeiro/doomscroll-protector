import { describe, expect, it } from 'vitest';
import { MS } from './setup.js';

const {
  DEFAULT_SETTINGS,
  MIN_THRESHOLD_SECONDS,
  dateKey,
  siteIdForHost,
  withDefaults,
  normaliseDay,
  ignoredCount,
  formatDuration,
  thresholdSeconds,
  quietMsForAction
} = MS;

describe('dateKey', () => {
  it('formats the local date, zero padded', () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('uses local time, not UTC, so late-evening scrolling counts as today', () => {
    // 2026-03-01T23:30 local is 2026-03-02 in UTC for positive offsets.
    const late = new Date(2026, 2, 1, 23, 30);
    expect(dateKey(late)).toBe('2026-03-01');
  });

  it('rolls over at local midnight', () => {
    expect(dateKey(new Date(2026, 2, 1, 23, 59, 59))).toBe('2026-03-01');
    expect(dateKey(new Date(2026, 2, 2, 0, 0, 1))).toBe('2026-03-02');
  });

  it('accepts a timestamp', () => {
    const stamp = new Date(2026, 5, 9, 12).getTime();
    expect(dateKey(stamp)).toBe('2026-06-09');
  });

  it('sorts lexicographically, which the pruning logic relies on', () => {
    const keys = ['2026-01-10', '2026-01-09', '2025-12-31'].sort();
    expect(keys).toEqual(['2025-12-31', '2026-01-09', '2026-01-10']);
  });
});

describe('siteIdForHost', () => {
  it.each([
    ['twitter.com', 'twitter'],
    ['x.com', 'twitter'],
    ['mobile.twitter.com', 'twitter'],
    ['www.reddit.com', 'reddit'],
    ['old.reddit.com', 'reddit'],
    ['m.youtube.com', 'youtube'],
    ['www.instagram.com', 'instagram'],
    ['WWW.INSTAGRAM.COM', 'instagram'],
    ['www.instagram.com.', 'instagram']
  ])('matches %s', (host, expected) => {
    expect(siteIdForHost(host)).toBe(expected);
  });

  it.each(['notreddit.com', 'reddit.com.evil.example', 'example.com', '', null, undefined])(
    'does not match %s',
    (host) => {
      expect(siteIdForHost(host)).toBeNull();
    }
  );
});

describe('withDefaults', () => {
  it('fills in defaults for empty or invalid input', () => {
    expect(withDefaults(null).scrollThresholdSeconds).toBe(DEFAULT_SETTINGS.scrollThresholdSeconds);
    expect(withDefaults('nonsense').enabled).toBe(true);
  });

  it('coerces numeric strings from <select> values', () => {
    expect(withDefaults({ scrollThresholdSeconds: '300' }).scrollThresholdSeconds).toBe(300);
  });

  it('falls back when a stored number is corrupt or non-positive', () => {
    expect(withDefaults({ cooldownSeconds: 'abc' }).cooldownSeconds).toBe(
      DEFAULT_SETTINGS.cooldownSeconds
    );
    expect(withDefaults({ cooldownSeconds: -5 }).cooldownSeconds).toBe(
      DEFAULT_SETTINGS.cooldownSeconds
    );
  });

  it('merges per-site flags without dropping unlisted sites', () => {
    const merged = withDefaults({ sites: { reddit: false } });
    expect(merged.sites).toEqual({
      twitter: true,
      reddit: false,
      youtube: true,
      instagram: true
    });
  });

  it('ignores unknown site keys', () => {
    expect(withDefaults({ sites: { tiktok: false } }).sites.tiktok).toBeUndefined();
  });
});

describe('normaliseDay / ignoredCount', () => {
  it('completes a partial day bucket', () => {
    expect(normaliseDay({ scrollSeconds: 12 })).toEqual({
      scrollSeconds: 12,
      interruptions: 0,
      actions: { continue: 0, break: 0, snooze: 0, ignored: 0 },
      perSite: {}
    });
  });

  it('counts Continue and auto-dismissals as ignored, breaks and snoozes as not', () => {
    expect(ignoredCount({ actions: { continue: 2, ignored: 1, break: 5, snooze: 3 } })).toBe(3);
    expect(ignoredCount(undefined)).toBe(0);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [35, '35s'],
    [260, '4m 20s'],
    [3600, '1h 00m'],
    [3840, '1h 04m'],
    [-10, '0s']
  ])('formats %s seconds as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe('thresholdSeconds', () => {
  const base = { scrollThresholdSeconds: 120, strictMode: false, adaptiveThreshold: true };

  it('returns the configured threshold when nothing has been ignored', () => {
    expect(thresholdSeconds(base, 0)).toBe(120);
  });

  it('shortens in strict mode', () => {
    expect(thresholdSeconds({ ...base, strictMode: true }, 0)).toBe(72);
  });

  it('shortens with each ignored nudge, and compounds with strict mode', () => {
    expect(thresholdSeconds(base, 1)).toBe(102);
    expect(thresholdSeconds(base, 2)).toBe(87);
    expect(thresholdSeconds({ ...base, strictMode: true }, 2)).toBe(52);
  });

  it('never adapts below half the configured threshold', () => {
    expect(thresholdSeconds(base, 50)).toBe(60);
  });

  it('never goes below the hard floor', () => {
    expect(thresholdSeconds({ ...base, scrollThresholdSeconds: 20, strictMode: true }, 40)).toBe(
      MIN_THRESHOLD_SECONDS
    );
  });

  it('ignores the adaptive factor when the setting is off', () => {
    expect(thresholdSeconds({ ...base, adaptiveThreshold: false }, 10)).toBe(120);
  });
});

describe('quietMsForAction', () => {
  const settings = { cooldownSeconds: 180, snoozeMinutes: 5, breakSeconds: 60 };

  it('uses the cooldown for continue and auto-dismiss', () => {
    expect(quietMsForAction(settings, 'continue')).toBe(180000);
    expect(quietMsForAction(settings, 'ignored')).toBe(180000);
  });

  it('uses the snooze period for snooze', () => {
    expect(quietMsForAction(settings, 'snooze')).toBe(300000);
  });

  it('covers the whole break plus the cooldown for break', () => {
    expect(quietMsForAction(settings, 'break')).toBe(240000);
  });

  it('halves quiet periods in strict mode', () => {
    expect(quietMsForAction({ ...settings, strictMode: true }, 'continue')).toBe(90000);
  });
});
