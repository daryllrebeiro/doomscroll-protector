import { describe, expect, it } from 'vitest';
import { MS } from './setup.js';

const { SCHEMA_VERSION, migrations } = MS;

describe('migrations', () => {
  it('treats unversioned MVP data as version 0 and upgrades it', () => {
    const result = migrations.migrate(
      { enabled: false, scrollThresholdSeconds: 300 },
      { '2026-05-30': { scrollSeconds: 42 } }
    );

    expect(result.changed).toBe(true);
    expect(result.settings.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.settings.enabled).toBe(false);
    expect(result.settings.scrollThresholdSeconds).toBe(300);
    // Newly introduced settings arrive with their defaults.
    expect(result.settings.breakSeconds).toBe(60);
    // Partial day buckets are completed rather than left ragged.
    expect(result.stats['2026-05-30']).toEqual({
      scrollSeconds: 42,
      interruptions: 0,
      actions: { continue: 0, break: 0, snooze: 0, ignored: 0 },
      perSite: {}
    });
  });

  it('drops keys that are not date buckets', () => {
    const result = migrations.migrate({}, { garbage: { scrollSeconds: 9 }, '2026-05-30': {} });
    expect(Object.keys(result.stats)).toEqual(['2026-05-30']);
  });

  it('is a no-op for current data', () => {
    const current = { schemaVersion: SCHEMA_VERSION, enabled: true };
    const result = migrations.migrate(current, {});
    expect(result.changed).toBe(false);
  });

  it('handles a completely empty install', () => {
    const result = migrations.migrate(undefined, undefined);
    expect(result.settings.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.stats).toEqual({});
  });

  it('has strictly increasing steps ending at the current version', () => {
    const versions = migrations.STEPS.map((step) => step.to);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(versions[versions.length - 1]).toBe(SCHEMA_VERSION);
  });
});
