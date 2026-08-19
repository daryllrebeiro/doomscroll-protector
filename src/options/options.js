/** Settings page: thresholds, per-site toggles, strict/adaptive mode. */
const { MESSAGES, SITES } = window.MindfulScroll;

const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, payload });

const NUMERIC_FIELDS = [
  'scrollThresholdSeconds',
  'snoozeMinutes',
  'cooldownSeconds',
  'breakSeconds',
  'maxInterruptionsPerHour'
];
const BOOLEAN_FIELDS = ['enabled', 'strictMode', 'adaptiveThreshold'];

const statusEl = document.getElementById('status');
const siteToggles = document.getElementById('siteToggles');

function renderSiteToggles(settings) {
  siteToggles.replaceChildren();
  for (const site of SITES) {
    const label = document.createElement('label');
    label.className = 'row';

    const text = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = site.label;
    const small = document.createElement('small');
    small.textContent = site.hosts.join(', ');
    text.append(strong, small);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.siteId = site.id;
    input.checked = settings.sites[site.id] !== false;

    label.append(text, input);
    siteToggles.append(label);
  }
}

function collect() {
  const settings = { sites: {} };
  for (const field of NUMERIC_FIELDS) {
    settings[field] = Number(document.getElementById(field).value);
  }
  for (const field of BOOLEAN_FIELDS) {
    settings[field] = document.getElementById(field).checked;
  }
  for (const input of siteToggles.querySelectorAll('input[data-site-id]')) {
    settings.sites[input.dataset.siteId] = input.checked;
  }
  return settings;
}

function apply(settings) {
  for (const field of NUMERIC_FIELDS) {
    document.getElementById(field).value = String(settings[field]);
  }
  for (const field of BOOLEAN_FIELDS) {
    document.getElementById(field).checked = Boolean(settings[field]);
  }
  renderSiteToggles(settings);
}

function flash(message) {
  statusEl.textContent = message;
  setTimeout(() => {
    statusEl.textContent = '';
  }, 2000);
}

document.getElementById('save').addEventListener('click', async () => {
  const response = await send(MESSAGES.SAVE_SETTINGS, { settings: collect() });
  if (response && response.settings) apply(response.settings);
  flash('Settings saved.');
});

document.getElementById('reset').addEventListener('click', async () => {
  await send(MESSAGES.RESET_STATS);
  flash('Statistics cleared.');
});

/** Everything the extension knows about you, as a file you can inspect. */
document.getElementById('export').addEventListener('click', async () => {
  const data = await send(MESSAGES.EXPORT_DATA);
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `mindful-scroll-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  flash('Data exported.');
});

document.getElementById('deleteAll').addEventListener('click', async () => {
  if (!confirm('Delete all Mindful Scroll settings and statistics? This cannot be undone.')) return;
  const response = await send(MESSAGES.DELETE_ALL_DATA);
  if (response && response.ok) {
    const fresh = await send(MESSAGES.GET_SETTINGS);
    if (fresh && fresh.settings) apply(fresh.settings);
  }
  flash('All data deleted.');
});

send(MESSAGES.GET_SETTINGS).then((response) => {
  if (response && response.settings) apply(response.settings);
});
