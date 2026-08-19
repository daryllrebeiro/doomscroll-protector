import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MS } from './setup.js';

const {
  DEFAULT_SETTINGS,
  MIN_THRESHOLD_SECONDS,
  dateKey,
  siteIdForHost,
  withDefaults,
  normaliseDay,
  ignoredCount,
  t,
  formatDuration,
  thresholdSeconds,
  quietMsForAction,
  analyzePeakUsage,
  generateInsights,
  getWeeklySummary,
  formatHour
} = MS;

describe('t', () => {
  afterEach(() => {
    delete globalThis.chrome;
  });

  it('falls back to the English source when there is no i18n API', () => {
    expect(t('actionContinue', 'Continue')).toBe('Continue');
  });

  it('falls back when the catalogue has no entry for the key', () => {
    globalThis.chrome = { i18n: { getMessage: () => '' } };
    expect(t('missingKey', 'Continue')).toBe('Continue');
  });

  it('passes substitutions through to chrome.i18n', () => {
    const calls = [];
    globalThis.chrome = {
      i18n: {
        getMessage: (key, substitutions) => {
          calls.push([key, substitutions]);
          return `Back in ${substitutions[0]}.`;
        }
      }
    };
    expect(t('breakCountdown', 'Back in 30s.', ['30s'])).toBe('Back in 30s.');
    expect(calls).toEqual([['breakCountdown', ['30s']]]);
  });
});

describe('_locales/en/messages.json', () => {
  const catalogue = JSON.parse(
    readFileSync(new URL('../_locales/en/messages.json', import.meta.url))
  );

  it('gives every message a non-empty string', () => {
    for (const [key, entry] of Object.entries(catalogue)) {
      expect(typeof entry.message, key).toBe('string');
      expect(entry.message.length, key).toBeGreaterThan(0);
    }
  });

  it('declares a placeholder for every $NAME$ used in a message', () => {
    for (const [key, entry] of Object.entries(catalogue)) {
      const used = [...entry.message.matchAll(/\$([A-Z_]+)\$/g)].map((m) => m[1].toLowerCase());
      const declared = Object.keys(entry.placeholders || {}).map((name) => name.toLowerCase());
      expect(used.sort(), key).toEqual(declared.sort());
    }
  });
});

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

describe('formatHour', () => {
  it.each([
    [0, '12 AM'],
    [1, '1 AM'],
    [11, '11 AM'],
    [12, '12 PM'],
    [13, '1 PM'],
    [23, '11 PM']
  ])('formats %s as %s', (hour, expected) => {
    expect(formatHour(hour)).toBe(expected);
  });
});

describe('analyzePeakUsage', () => {
  it('returns null when there is no data', () => {
    expect(analyzePeakUsage({})).toBeNull();
  });

  it('finds the peak hour and day from daily buckets', () => {
    const stats = {
      '2026-06-01': { scrollSeconds: 3600, actions: {}, perSite: {} },
      '2026-06-02': { scrollSeconds: 7200, actions: {}, perSite: {} },
      '2026-06-03': { scrollSeconds: 1800, actions: {}, perSite: {} }
    };
    const result = analyzePeakUsage(stats);
    expect(result).not.toBeNull();
    expect(result.totalDays).toBe(3);
    expect(result.averageDailySeconds).toBe(4200);
    // Peak day should be the one with the most scrolling
    expect(result.peakDay).toBeDefined();
    expect(result.peakHourFormatted).toBeDefined();
  });

  it('ignores non-date keys in the stats object', () => {
    const stats = {
      '2026-06-01': { scrollSeconds: 100, actions: {}, perSite: {} },
      garbage: { scrollSeconds: 9999, actions: {}, perSite: {} }
    };
    const result = analyzePeakUsage(stats);
    expect(result.totalDays).toBe(1);
  });
});

describe('generateInsights', () => {
  it('returns a starter message when there is no data', () => {
    const insights = generateInsights({});
    expect(insights.length).toBe(1);
    expect(insights[0]).toContain('Start using');
  });

  it('generates insights from usage data', () => {
    const stats = {
      '2026-06-01': {
        scrollSeconds: 3600,
        interruptions: 5,
        actions: { continue: 2, break: 1, snooze: 1, ignored: 1 },
        perSite: {}
      },
      '2026-06-02': {
        scrollSeconds: 7200,
        interruptions: 3,
        actions: { continue: 1, break: 1, snooze: 0, ignored: 1 },
        perSite: {}
      }
    };
    const insights = generateInsights(stats);
    expect(insights.length).toBeGreaterThan(0);
    // Should mention peak time and day
    expect(insights.some((i) => i.includes('scroll most'))).toBe(true);
    expect(insights.some((i) => i.includes('most active day'))).toBe(true);
  });

  it('reports a high ignore rate', () => {
    const stats = {
      '2026-06-01': {
        scrollSeconds: 3600,
        interruptions: 10,
        actions: { continue: 6, break: 0, snooze: 0, ignored: 4 },
        perSite: {}
      }
    };
    const insights = generateInsights(stats);
    expect(insights.some((i) => i.includes('ignore 100%'))).toBe(true);
  });

  it('praises a low ignore rate', () => {
    const stats = {
      '2026-06-01': {
        scrollSeconds: 3600,
        interruptions: 10,
        actions: { continue: 1, break: 8, snooze: 1, ignored: 0 },
        perSite: {}
      }
    };
    const insights = generateInsights(stats);
    expect(insights.some((i) => i.includes('only ignore 10%'))).toBe(true);
  });
});

describe('getWeeklySummary', () => {
  it('returns zeros when there is no data', () => {
    const summary = getWeeklySummary({});
    expect(summary).toEqual({
      totalSeconds: 0,
      totalMinutes: 0,
      totalInterruptions: 0,
      totalBreaks: 0,
      totalIgnored: 0,
      daysWithData: 0,
      averageDailyMinutes: 0
    });
  });

  it('aggregates the last 7 days of data', () => {
    const stats = {};
    for (let i = 1; i <= 10; i += 1) {
      const day = String(i).padStart(2, '0');
      stats[`2026-06-${day}`] = {
        scrollSeconds: 600,
        interruptions: 2,
        actions: { continue: 1, break: 1, snooze: 0, ignored: 0 },
        perSite: {}
      };
    }
    const summary = getWeeklySummary(stats);
    // Only the last 7 of 10 days are counted
    expect(summary.daysWithData).toBe(7);
    expect(summary.totalSeconds).toBe(4200);
    expect(summary.totalMinutes).toBe(70);
    expect(summary.totalInterruptions).toBe(14);
    expect(summary.totalBreaks).toBe(7);
    expect(summary.totalIgnored).toBe(7);
    expect(summary.averageDailyMinutes).toBe(10);
  });
});
