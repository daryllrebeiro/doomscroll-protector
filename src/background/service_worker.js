// @ts-nocheck — thin wiring shell; type checking focuses on the pure logic files.
/**
 * Mindful Scroll – background service worker (Manifest V3).
 *
 * Responsibilities:
 *  - own settings + aggregated daily stats in chrome.storage.local, with migrations
 *  - batch writes: content scripts report seconds, we buffer them and commit on an
 *    alarm, so open feed tabs cannot approach the storage write quota
 *  - hold per-tab runtime state (cooldown, break, nudge history) in
 *    chrome.storage.session, which survives worker suspension but not a restart
 *
 * MV3 workers are killed aggressively, so nothing that matters may live only in
 * a module-level variable: buffers are flushed on `onSuspend` and every alarm.
 */
importScripts('/src/shared/constants.js', '/src/shared/migrations.js');

const {
  STORAGE_KEYS,
  MESSAGES,
  HISTORY_DAYS,
  dateKey,
  withDefaults,
  emptyDay,
  normaliseDay,
  ignoredCount,
  migrations,
  siteIdForHost,
  generateInsights,
  getWeeklySummary
} = self.MindfulScroll;

/** Commit buffered stats at most once a minute (alarms cannot fire faster). */
const FLUSH_ALARM = 'mindful-scroll-flush';
const FLUSH_PERIOD_MINUTES = 1;

/**
 * Commit early once this much unsaved scrolling has piled up. `onSuspend` is
 * not guaranteed to finish an async write, so the buffer must never hold more
 * than a couple of minutes of data across all tabs.
 */
const MAX_BUFFERED_SECONDS = 120;

/**
 * date -> pending increments, buffered between commits.
 * @type {Map<string, { scrollSeconds: number, interruptions: number, actions: object, perSite: object }>}
 */
const buffer = new Map();

/* ---------------------------------------------------------------- storage */

async function readAll() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.settings, STORAGE_KEYS.stats]);
  return {
    settings: stored[STORAGE_KEYS.settings],
    stats: stored[STORAGE_KEYS.stats] || {}
  };
}

async function getSettings() {
  const { settings } = await readAll();
  return withDefaults(settings);
}

async function saveSettings(partial) {
  const next = withDefaults({ ...(await getSettings()), ...(partial || {}) });
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
  return next;
}

async function getStats() {
  const { stats } = await readAll();
  return stats;
}

/** Run pending migrations once, at install/update and defensively at startup. */
async function runMigrations() {
  const { settings, stats } = await readAll();
  const result = migrations.migrate(settings, stats);
  if (!result.changed && settings) return;
  await chrome.storage.local.set({
    [STORAGE_KEYS.settings]: result.settings,
    [STORAGE_KEYS.stats]: result.stats
  });
}

/* ------------------------------------------------------ buffered stat writes */

function bufferFor(date) {
  if (!buffer.has(date)) {
    buffer.set(date, {
      scrollSeconds: 0,
      interruptions: 0,
      actions: {},
      perSite: {}
    });
  }
  return buffer.get(date);
}

function bufferSite(entry, site) {
  if (!entry.perSite[site]) {
    entry.perSite[site] = { scrollSeconds: 0, interruptions: 0, ignored: 0 };
  }
  return entry.perSite[site];
}

/**
 * Commit the buffer into storage. Serialised through a promise chain, and the
 * buffer is drained *before* the read so a concurrent report is never lost:
 * anything arriving mid-commit lands in a fresh buffer entry and is written by
 * the next flush.
 */
let commitQueue = Promise.resolve();
function commit() {
  if (buffer.size === 0) return commitQueue;

  const drained = new Map(buffer);
  buffer.clear();

  commitQueue = commitQueue.then(async () => {
    const stats = await getStats();
    for (const [date, delta] of drained) {
      const day = normaliseDay(stats[date]);
      day.scrollSeconds += delta.scrollSeconds;
      day.interruptions += delta.interruptions;
      for (const [action, count] of Object.entries(delta.actions)) {
        day.actions[action] = (day.actions[action] || 0) + count;
      }
      for (const [site, siteDelta] of Object.entries(delta.perSite)) {
        const bucket = day.perSite[site] || { scrollSeconds: 0, interruptions: 0, ignored: 0 };
        bucket.scrollSeconds += siteDelta.scrollSeconds;
        bucket.interruptions += siteDelta.interruptions;
        bucket.ignored += siteDelta.ignored;
        day.perSite[site] = bucket;
      }
      stats[date] = day;
    }
    prune(stats);
    await chrome.storage.local.set({ [STORAGE_KEYS.stats]: stats });
  });

  return commitQueue;
}

/** Drop buckets older than HISTORY_DAYS; the daily reset falls out of the keys. */
function prune(stats) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - HISTORY_DAYS);
  const cutoffKey = dateKey(cutoff);
  for (const key of Object.keys(stats)) {
    if (key < cutoffKey) delete stats[key];
  }
}

/** Stats as the UI should see them: committed storage plus the live buffer. */
async function statsWithBuffer() {
  const stats = await getStats();
  const merged = {};
  for (const [date, day] of Object.entries(stats)) merged[date] = normaliseDay(day);
  for (const [date, delta] of buffer) {
    const day = merged[date] || emptyDay();
    day.scrollSeconds += delta.scrollSeconds;
    day.interruptions += delta.interruptions;
    for (const [action, count] of Object.entries(delta.actions)) {
      day.actions[action] = (day.actions[action] || 0) + count;
    }
    for (const [site, siteDelta] of Object.entries(delta.perSite)) {
      const bucket = day.perSite[site] || { scrollSeconds: 0, interruptions: 0, ignored: 0 };
      bucket.scrollSeconds += siteDelta.scrollSeconds;
      bucket.interruptions += siteDelta.interruptions;
      bucket.ignored += siteDelta.ignored;
      day.perSite[site] = bucket;
    }
    merged[date] = day;
  }
  return merged;
}

/* ------------------------------------------------- per-tab runtime + sessions */

const runtimeKey = (tabId, site) => `runtime:${tabId}:${site}`;
const sessionKey = (tabId) => `session:${tabId}`;

async function readRuntime(tabId, site) {
  if (typeof tabId !== 'number') return {};
  const key = runtimeKey(tabId, site);
  const stored = await chrome.storage.session.get(key);
  return stored[key] || {};
}

async function writeRuntime(tabId, site, runtime) {
  if (typeof tabId !== 'number') return;
  await chrome.storage.session.set({ [runtimeKey(tabId, site)]: runtime });
}

/** Per-tab session counters, in storage.session so a worker restart keeps them. */
async function updateSession(tabId, site, mutate) {
  if (typeof tabId !== 'number') return;
  const key = sessionKey(tabId);
  const stored = await chrome.storage.session.get(key);
  const session =
    stored[key] && stored[key].site === site
      ? stored[key]
      : { site, startedAt: Date.now(), scrollSeconds: 0, interruptions: 0 };
  mutate(session);
  await chrome.storage.session.set({ [key]: session });
}

/* --------------------------------------------------------------- messages */

const handlers = {
  async [MESSAGES.GET_SETTINGS]() {
    return { settings: await getSettings() };
  },

  async [MESSAGES.SAVE_SETTINGS](payload) {
    return { settings: await saveSettings(payload && payload.settings) };
  },

  async [MESSAGES.GET_STATS]() {
    const stats = await statsWithBuffer();
    const today = normaliseDay(stats[dateKey()]);
    return { today, stats, settings: await getSettings(), ignoredToday: ignoredCount(today) };
  },

  async [MESSAGES.GET_INSIGHTS]() {
    const stats = await statsWithBuffer();
    const insights = generateInsights(stats);
    return { insights };
  },

  async [MESSAGES.GET_WEEKLY_SUMMARY]() {
    const stats = await statsWithBuffer();
    const summary = getWeeklySummary(stats);
    return { summary };
  },

  /** Everything a freshly injected content script needs, in one round-trip. */
  async [MESSAGES.GET_CONTEXT](payload, sender) {
    const tabId = sender.tab && sender.tab.id;
    const stats = await statsWithBuffer();
    return {
      settings: await getSettings(),
      ignoredToday: ignoredCount(stats[dateKey()]),
      runtime: await readRuntime(tabId, payload.site)
    };
  },

  async [MESSAGES.SET_RUNTIME](payload, sender) {
    await writeRuntime(sender.tab && sender.tab.id, payload.site, payload.runtime || {});
    return { ok: true };
  },

  async [MESSAGES.RESET_STATS]() {
    buffer.clear();
    await chrome.storage.local.set({ [STORAGE_KEYS.stats]: {} });
    return { ok: true };
  },

  async [MESSAGES.EXPORT_DATA]() {
    return {
      exportedAt: new Date().toISOString(),
      settings: await getSettings(),
      stats: await statsWithBuffer()
    };
  },

  async [MESSAGES.IMPORT_DATA](payload) {
    const { settings, stats } = (payload && payload.data) || {};
    if (!settings || typeof settings !== 'object') {
      return { ok: false, error: 'Invalid settings data' };
    }

    // Import settings with validation
    const importedSettings = withDefaults(settings);
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: importedSettings });

    // Optionally import stats if provided and valid
    if (stats && typeof stats === 'object') {
      const validatedStats = {};
      for (const [key, day] of Object.entries(stats)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
          validatedStats[key] = normaliseDay(day);
        }
      }
      await chrome.storage.local.set({ [STORAGE_KEYS.stats]: validatedStats });
    }

    return { ok: true, settings: importedSettings };
  },

  async [MESSAGES.DELETE_ALL_DATA]() {
    buffer.clear();
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    await saveSettings({});
    return { ok: true };
  },

  /**
   * Seconds of active scrolling, already attributed to the day they accrued in
   * by the content script (so a run spanning midnight splits correctly).
   */
  async [MESSAGES.SCROLL_TICK](payload, sender) {
    const site = payload.site;
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    if (!site || entries.length === 0) return { ok: false };

    let total = 0;
    for (const entry of entries) {
      const seconds = Math.max(0, Math.min(3600, Number(entry.seconds) || 0));
      const date = /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : dateKey();
      if (!seconds) continue;
      const bucket = bufferFor(date);
      bucket.scrollSeconds += seconds;
      bufferSite(bucket, site).scrollSeconds += seconds;
      total += seconds;
    }
    await updateSession(sender.tab && sender.tab.id, site, (session) => {
      session.scrollSeconds += total;
    });

    let buffered = 0;
    for (const entry of buffer.values()) buffered += entry.scrollSeconds;
    if (buffered >= MAX_BUFFERED_SECONDS) commit();

    return { ok: true };
  },

  async [MESSAGES.INTERRUPTION_SHOWN](payload, sender) {
    const bucket = bufferFor(dateKey());
    bucket.interruptions += 1;
    bufferSite(bucket, payload.site).interruptions += 1;
    await updateSession(sender.tab && sender.tab.id, payload.site, (session) => {
      session.interruptions += 1;
    });
    return { ok: true };
  },

  /** action: 'continue' | 'break' | 'snooze' | 'ignored' */
  async [MESSAGES.INTERRUPTION_ACTION](payload) {
    const { site, action } = payload;
    if (!action) return { ok: false };

    const bucket = bufferFor(dateKey());
    bucket.actions[action] = (bucket.actions[action] || 0) + 1;
    if (action === 'continue' || action === 'ignored') {
      bufferSite(bucket, site).ignored += 1;
    }

    // Commit immediately: the adaptive threshold reads this back, and an
    // interruption is rare enough that a write per action is cheap.
    await commit();
    const stats = await statsWithBuffer();
    return { ok: true, ignoredToday: ignoredCount(stats[dateKey()]) };
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = message && handlers[message.type];
  if (!handler) return false;
  handler(message.payload || {}, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true; // keep the message channel open for the async response
});

/* -------------------------------------------------------------- lifecycle */

chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_PERIOD_MINUTES });

const SCHEDULE_ALARM = 'mindful-scroll-schedule-check';
chrome.alarms.create(SCHEDULE_ALARM, { periodInMinutes: 5 });

/** Check if current time is within the scheduled active window */
function isWithinSchedule(settings) {
  if (!settings.scheduleEnabled) return true;
  const now = new Date();
  const currentHour = now.getHours();
  const start = settings.scheduleStartHour || 21;
  const end = settings.scheduleEndHour || 1;
  if (start <= end) {
    return currentHour >= start && currentHour < end;
  } else {
    return currentHour >= start || currentHour < end;
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === FLUSH_ALARM) {
    commit();
  } else if (alarm.name === SCHEDULE_ALARM) {
    const settings = await getSettings();
    if (settings.scheduleEnabled) {
      const shouldBeEnabled = isWithinSchedule(settings);
      if (settings.enabled !== shouldBeEnabled) {
        await saveSettings({ enabled: shouldBeEnabled });
      }
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await commit();
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter(
    (key) => key === sessionKey(tabId) || key.startsWith(`runtime:${tabId}:`)
  );
  if (keys.length) await chrome.storage.session.remove(keys);
});

chrome.runtime.onInstalled.addListener(async () => {
  await runMigrations();
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_PERIOD_MINUTES });
  chrome.alarms.create(SCHEDULE_ALARM, { periodInMinutes: 5 });

  // Check schedule on install/update
  const settings = await getSettings();
  if (settings.scheduleEnabled) {
    const shouldBeEnabled = isWithinSchedule(settings);
    if (settings.enabled !== shouldBeEnabled) {
      await saveSettings({ enabled: shouldBeEnabled });
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  runMigrations();
  chrome.alarms.create(SCHEDULE_ALARM, { periodInMinutes: 5 });

  // Check schedule on startup
  const settings = await getSettings();
  if (settings.scheduleEnabled) {
    const shouldBeEnabled = isWithinSchedule(settings);
    if (settings.enabled !== shouldBeEnabled) {
      await saveSettings({ enabled: shouldBeEnabled });
    }
  }
});

// Handle keyboard commands
chrome.commands.onCommand.addListener(async (command) => {
  const settings = await getSettings();
  const t = (key, fallback) => chrome.i18n.getMessage(key) || fallback;

  switch (command) {
    case 'toggle-extension': {
      await saveSettings({ enabled: !settings.enabled });
      // Show notification for the toggle action
      if (chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'assets/icon128.png',
          title: 'Mindful Scroll',
          message: settings.enabled
            ? t('notificationPaused', 'Mindful Scroll paused')
            : t('notificationEnabled', 'Mindful Scroll enabled')
        });
      }
      break;
    }

    case 'open-settings': {
      chrome.runtime.openOptionsPage();
      break;
    }

    case 'quick-snooze': {
      // Set a temporary quiet period for all tabs
      const quietUntil = Date.now() + settings.snoozeMinutes * 60 * 1000;
      const allTabs = await chrome.tabs.query({});
      for (const tab of allTabs) {
        const url = tab.url;
        let site = null;
        if (url) {
          try {
            const hostname = new URL(url).hostname;
            site = siteIdForHost(hostname);
          } catch {
            // Invalid URL, skip this tab
          }
        }
        if (site) {
          await writeRuntime(tab.id, site, { quietUntil });
        }
      }
      if (chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'assets/icon128.png',
          title: 'Mindful Scroll',
          message: t('notificationSnoozed', `Snoozed for ${settings.snoozeMinutes} minutes`, [
            settings.snoozeMinutes
          ])
        });
      }
      break;
    }
  }
});

// Last chance to persist before the worker is torn down.
chrome.runtime.onSuspend.addListener(() => commit());
