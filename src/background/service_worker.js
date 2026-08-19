/**
 * Mindful Scroll – background service worker (Manifest V3).
 *
 * Responsibilities:
 *  - own the persisted settings + aggregated daily stats in chrome.storage.local
 *  - aggregate scroll/interruption events coming from content scripts
 *  - serve settings and stats to the popup / options page
 *  - keep lightweight per-tab session state (in memory only; MV3 workers die)
 */
importScripts('/src/shared/constants.js');

const {
  STORAGE_KEYS,
  MESSAGES,
  dateKey,
  withDefaults,
  emptyDay
} = self.MindfulScroll;

/** Days of history to keep; older buckets are pruned on write. */
const HISTORY_DAYS = 14;

/** tabId -> { site, startedAt, scrollSeconds, interruptions } */
const sessions = new Map();

/* ---------------------------------------------------------------- storage */

async function getSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return withDefaults(stored[STORAGE_KEYS.settings]);
}

async function saveSettings(partial) {
  const next = withDefaults({ ...(await getSettings()), ...(partial || {}) });
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
  return next;
}

async function getStats() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.stats);
  return stored[STORAGE_KEYS.stats] || {};
}

/**
 * Read-modify-write of today's stats bucket. Serialised through a promise
 * chain because several tabs can report events at the same time.
 */
let writeQueue = Promise.resolve();
function updateToday(mutate) {
  writeQueue = writeQueue.then(async () => {
    const stats = await getStats();
    const key = dateKey();
    const day = { ...emptyDay(), ...(stats[key] || {}) };
    day.actions = { ...emptyDay().actions, ...(day.actions || {}) };
    day.perSite = { ...(day.perSite || {}) };

    mutate(day);

    stats[key] = day;
    prune(stats);
    await chrome.storage.local.set({ [STORAGE_KEYS.stats]: stats });
    return day;
  });
  return writeQueue;
}

/** Drop buckets older than HISTORY_DAYS (daily reset comes for free from keys). */
function prune(stats) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - HISTORY_DAYS);
  const cutoffKey = dateKey(cutoff);
  for (const key of Object.keys(stats)) {
    if (key < cutoffKey) delete stats[key];
  }
}

function siteBucket(day, site) {
  if (!day.perSite[site]) {
    day.perSite[site] = { scrollSeconds: 0, interruptions: 0, ignored: 0 };
  }
  return day.perSite[site];
}

/* --------------------------------------------------------------- sessions */

function session(tabId, site) {
  let s = sessions.get(tabId);
  if (!s || s.site !== site) {
    s = { site, startedAt: Date.now(), scrollSeconds: 0, interruptions: 0 };
    sessions.set(tabId, s);
  }
  return s;
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
    const stats = await getStats();
    const today = { ...emptyDay(), ...(stats[dateKey()] || {}) };
    return { today, stats, settings: await getSettings() };
  },

  async [MESSAGES.RESET_STATS]() {
    await chrome.storage.local.set({ [STORAGE_KEYS.stats]: {} });
    sessions.clear();
    return { ok: true };
  },

  /** Content script reports N seconds of active scrolling. */
  async [MESSAGES.SCROLL_TICK](payload, sender) {
    const seconds = Math.max(0, Math.min(60, Number(payload.seconds) || 0));
    const site = payload.site;
    if (!seconds || !site) return { ok: false };

    if (sender.tab && typeof sender.tab.id === 'number') {
      session(sender.tab.id, site).scrollSeconds += seconds;
    }
    await updateToday((day) => {
      day.scrollSeconds += seconds;
      siteBucket(day, site).scrollSeconds += seconds;
    });
    return { ok: true };
  },

  async [MESSAGES.INTERRUPTION_SHOWN](payload, sender) {
    const site = payload.site;
    if (sender.tab && typeof sender.tab.id === 'number') {
      session(sender.tab.id, site).interruptions += 1;
    }
    await updateToday((day) => {
      day.interruptions += 1;
      siteBucket(day, site).interruptions += 1;
    });
    return { ok: true };
  },

  /** action: 'continue' | 'break' | 'snooze' | 'ignored' */
  async [MESSAGES.INTERRUPTION_ACTION](payload) {
    const { site, action } = payload;
    if (!action) return { ok: false };
    const day = await updateToday((d) => {
      d.actions[action] = (d.actions[action] || 0) + 1;
      // "Continue" and timeouts both mean the nudge did not change behaviour.
      if (action === 'continue' || action === 'ignored') {
        siteBucket(d, site).ignored += 1;
      }
    });
    // Content scripts use the ignored count to adapt their threshold.
    return { ok: true, ignoredToday: day.actions.continue + day.actions.ignored };
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

chrome.tabs.onRemoved.addListener((tabId) => sessions.delete(tabId));

chrome.runtime.onInstalled.addListener(async () => {
  // Materialise defaults so the options page has something concrete to show.
  await saveSettings({});
});
