/** Popup dashboard: today's scrolling, nudges and how many were ignored. */
const { MESSAGES, SITES, dateKey, normaliseDay, ignoredCount, formatDuration } =
  window.MindfulScroll;

const els = {
  enabled: document.getElementById('enabled'),
  scrollTime: document.getElementById('scrollTime'),
  interruptions: document.getElementById('interruptions'),
  ignored: document.getElementById('ignored'),
  summary: document.getElementById('summary'),
  trend: document.getElementById('trend'),
  siteList: document.getElementById('siteList'),
  openOptions: document.getElementById('openOptions')
};

const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, payload });

function renderSites(perSite) {
  els.siteList.replaceChildren();
  const entries = SITES.map((site) => ({
    label: site.label,
    seconds: (perSite[site.id] || {}).scrollSeconds || 0
  }))
    .filter((entry) => entry.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);

  if (entries.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'site empty';
    empty.textContent = 'No scrolling tracked yet today.';
    els.siteList.append(empty);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement('li');
    item.className = 'site';
    const name = document.createElement('span');
    name.textContent = entry.label;
    const value = document.createElement('span');
    value.className = 'site-value';
    value.textContent = formatDuration(entry.seconds);
    item.append(name, value);
    els.siteList.append(item);
  }
}

/** Seven CSS bars, scaled to the busiest day, so a trend is visible at a glance. */
function renderTrend(stats) {
  els.trend.replaceChildren();
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const key = dateKey(date);
    days.push({
      key,
      label: date.toLocaleDateString(undefined, { weekday: 'narrow' }),
      seconds: normaliseDay(stats[key]).scrollSeconds
    });
  }
  const max = Math.max(...days.map((day) => day.seconds), 1);

  for (const day of days) {
    const item = document.createElement('li');
    item.className = 'trend-day';
    item.title = `${day.key}: ${formatDuration(day.seconds)}`;

    const bar = document.createElement('span');
    bar.className = 'trend-bar';
    bar.style.height = `${Math.max(2, Math.round((day.seconds / max) * 36))}px`;

    const label = document.createElement('span');
    label.className = 'trend-label';
    label.textContent = day.label;

    item.append(bar, label);
    els.trend.append(item);
  }
}

function renderError() {
  els.summary.textContent = 'Could not load stats — try reopening the popup.';
  els.scrollTime.textContent = '–';
  els.interruptions.textContent = '–';
  els.ignored.textContent = '–';
}

async function render() {
  const response = await send(MESSAGES.GET_STATS);
  if (!response || !response.today) {
    renderError();
    return;
  }
  const { today, stats, settings } = response;
  const ignored = ignoredCount(today);

  els.enabled.checked = Boolean(settings.enabled);
  els.scrollTime.textContent = formatDuration(today.scrollSeconds);
  els.interruptions.textContent = String(today.interruptions);
  els.ignored.textContent = String(ignored);
  els.summary.textContent =
    today.interruptions === 0
      ? 'No interruptions yet today.'
      : `You ignored ${ignored} of ${today.interruptions} interruption${today.interruptions === 1 ? '' : 's'}, and took ${today.actions.break || 0} break${(today.actions.break || 0) === 1 ? '' : 's'}.`;

  renderTrend(stats || {});
  renderSites(today.perSite || {});
}

els.enabled.addEventListener('change', async () => {
  await send(MESSAGES.SAVE_SETTINGS, { settings: { enabled: els.enabled.checked } });
});

els.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

render().catch(renderError);
