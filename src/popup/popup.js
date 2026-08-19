// @ts-nocheck — thin wiring shell; type checking focuses on the pure logic files.
/** Popup dashboard: today's scrolling, nudges and how many were ignored. */
const { MESSAGES, SITES, dateKey, normaliseDay, ignoredCount, formatDuration, t } =
  window.MindfulScroll;

const els = {
  enabled: document.getElementById('enabled'),
  scrollTime: document.getElementById('scrollTime'),
  interruptions: document.getElementById('interruptions'),
  ignored: document.getElementById('ignored'),
  summary: document.getElementById('summary'),
  trend: document.getElementById('trend'),
  weeklySummary: document.getElementById('weeklySummary'),
  insights: document.getElementById('insights'),
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
    empty.textContent = t('popupNoScrolling', 'No scrolling tracked yet today.');
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
      seconds: normaliseDay(stats[key]).scrollSeconds,
      isToday: offset === 0
    });
  }
  const max = Math.max(...days.map((day) => day.seconds), 1);

  // Calculate trend direction (compare today vs yesterday)
  const todaySeconds = days[days.length - 1].seconds;
  const yesterdaySeconds = days[days.length - 2].seconds;
  const trendDirection =
    todaySeconds > yesterdaySeconds ? 'up' : todaySeconds < yesterdaySeconds ? 'down' : 'same';

  for (const day of days) {
    const item = document.createElement('li');
    item.className = 'trend-day';
    item.title = `${day.key}: ${formatDuration(day.seconds)}`;

    const bar = document.createElement('span');
    bar.className = 'trend-bar';
    bar.style.height = `${Math.max(2, Math.round((day.seconds / max) * 36))}px`;

    // Color code based on usage intensity
    const intensity = day.seconds / max;
    if (intensity > 0.8) {
      bar.classList.add('trend-bar-high');
    } else if (intensity > 0.5) {
      bar.classList.add('trend-bar-medium');
    }

    // Highlight today
    if (day.isToday) {
      bar.classList.add('trend-bar-today');
    }

    const label = document.createElement('span');
    label.className = 'trend-label';
    label.textContent = day.label;

    item.append(bar, label);
    els.trend.append(item);
  }

  // Add trend indicator (compare today vs yesterday)
  if (trendDirection !== 'same' && days[days.length - 1].isToday) {
    const trendIndicator = document.createElement('div');
    trendIndicator.className = 'trend-indicator';
    const arrow = trendDirection === 'up' ? '↑' : '↓';
    const message = trendDirection === 'up' ? 'Usage increased today' : 'Usage decreased today';
    trendIndicator.textContent = `${arrow} ${message}`;
    trendIndicator.classList.add(trendDirection === 'up' ? 'trend-up' : 'trend-down');
    els.trend.parentElement.insertBefore(trendIndicator, els.trend.nextSibling);
  }
}

function renderError() {
  els.summary.textContent = t('popupError', 'Could not load stats — try reopening the popup.');
  els.scrollTime.textContent = '–';
  els.interruptions.textContent = '–';
  els.ignored.textContent = '–';
}

function renderWeeklySummary(summary) {
  els.weeklySummary.replaceChildren();
  if (!summary || summary.daysWithData === 0) {
    const empty = document.createElement('div');
    empty.className = 'weekly-summary-item';
    empty.textContent = 'No weekly data yet.';
    els.weeklySummary.append(empty);
    return;
  }

  const items = [
    { label: 'Total time', value: formatDuration(summary.totalSeconds) },
    { label: 'Daily average', value: `${summary.averageDailyMinutes} min` },
    { label: 'Nudges', value: String(summary.totalInterruptions) },
    { label: 'Breaks taken', value: String(summary.totalBreaks) }
  ];

  for (const item of items) {
    const div = document.createElement('div');
    div.className = 'weekly-summary-item';
    const label = document.createElement('span');
    label.textContent = item.label;
    const value = document.createElement('span');
    value.textContent = item.value;
    div.append(label, value);
    els.weeklySummary.append(div);
  }
}

function renderInsights(insights) {
  els.insights.replaceChildren();
  if (!insights || insights.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'insight';
    empty.textContent = 'Use Mindful Scroll more to get personalized insights.';
    els.insights.append(empty);
    return;
  }

  for (const insight of insights) {
    const li = document.createElement('li');
    li.className = 'insight';
    li.textContent = insight;
    els.insights.append(li);
  }
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
  const breaks = today.actions.break || 0;
  els.summary.textContent =
    today.interruptions === 0
      ? t('popupNoInterruptions', 'No interruptions yet today.')
      : t(
          'popupSummary',
          `Ignored ${ignored} of ${today.interruptions} nudges today · ${breaks} breaks taken.`,
          [String(ignored), String(today.interruptions), String(breaks)]
        );

  renderTrend(stats || {});
  renderSites(today.perSite || {});

  // Load weekly summary and insights
  const [weeklyResponse, insightsResponse] = await Promise.all([
    send(MESSAGES.GET_WEEKLY_SUMMARY),
    send(MESSAGES.GET_INSIGHTS)
  ]);

  if (weeklyResponse && weeklyResponse.summary) {
    renderWeeklySummary(weeklyResponse.summary);
  }

  if (insightsResponse && insightsResponse.insights) {
    renderInsights(insightsResponse.insights);
  }
}

els.enabled.addEventListener('change', async () => {
  await send(MESSAGES.SAVE_SETTINGS, { settings: { enabled: els.enabled.checked } });
});

els.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

render().catch(renderError);
