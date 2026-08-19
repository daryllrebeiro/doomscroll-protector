/**
 * Storage migrations.
 *
 * Every persisted root carries a `schemaVersion`. Steps run in order from the
 * stored version up to SCHEMA_VERSION, so a user who skips several releases is
 * upgraded through each step. Unversioned data (pre-1.1 installs) is treated as
 * version 0.
 *
 * Classic script: loaded via importScripts() in the service worker.
 */
(function attachMigrations(global) {
  const { SCHEMA_VERSION, withDefaults, normaliseDay } = global.MindfulScroll;

  /**
   * @type {{ to: number, migrate: (data: {settings: object, stats: object}) => {settings: object, stats: object} }[]}
   */
  const STEPS = [
    {
      // 0 -> 1: the MVP stored settings without a version and day buckets that
      // could be missing `actions`/`perSite`. Normalise both shapes.
      to: 1,
      migrate({ settings, stats }) {
        const nextStats = {};
        for (const [key, day] of Object.entries(stats || {})) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue; // drop junk keys
          nextStats[key] = normaliseDay(day);
        }
        return { settings: withDefaults(settings), stats: nextStats };
      }
    }
  ];

  function versionOf(settings) {
    const version = Number(settings && settings.schemaVersion);
    return Number.isFinite(version) ? version : 0;
  }

  /**
   * Bring stored data up to the current schema.
   * @returns {{ settings: object, stats: object, changed: boolean }}
   */
  function migrate(storedSettings, storedStats) {
    let from = versionOf(storedSettings);
    if (from >= SCHEMA_VERSION) {
      return { settings: withDefaults(storedSettings), stats: storedStats || {}, changed: false };
    }

    let data = { settings: storedSettings || {}, stats: storedStats || {} };
    for (const step of STEPS) {
      if (step.to <= from) continue;
      data = step.migrate(data);
      from = step.to;
    }
    data.settings = { ...withDefaults(data.settings), schemaVersion: SCHEMA_VERSION };
    return { ...data, changed: true };
  }

  global.MindfulScroll.migrations = { migrate, versionOf, STEPS };
})(typeof self !== 'undefined' ? self : globalThis);
