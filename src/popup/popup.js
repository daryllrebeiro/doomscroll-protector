/** Popup dashboard: today's scrolling, nudges and how many were ignored. */
const { MESSAGES, SITES, formatDuration } = window.MindfulScroll;

const els = {
  enabled: document.getElementById('enabled'),
  scrollTime: document.getElementById('scrollTime'),
  interruptions: document.getElementById('interruptions'),
  ignored: document.getElementById('ignored'),
  summary: document.getElementById('summary'),
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

async function render() {
  const response = await send(MESSAGES.GET_STATS);
  if (!response) return;
  const { today, settings } = response;
  const ignored = (today.actions.continue || 0) + (today.actions.ignored || 0);

  els.enabled.checked = Boolean(settings.enabled);
  els.scrollTime.textContent = formatDuration(today.scrollSeconds);
  els.interruptions.textContent = String(today.interruptions);
  els.ignored.textContent = String(ignored);
  els.summary.textContent =
    today.interruptions === 0
      ? 'No interruptions yet today.'
      : `You ignored ${ignored} of ${today.interruptions} interruption${today.interruptions === 1 ? '' : 's'}, and took ${today.actions.break || 0} break${(today.actions.break || 0) === 1 ? '' : 's'}.`;

  renderSites(today.perSite || {});
}

els.enabled.addEventListener('change', async () => {
  await send(MESSAGES.SAVE_SETTINGS, { settings: { enabled: els.enabled.checked } });
});

els.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

render();
