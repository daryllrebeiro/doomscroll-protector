# Mindful Scroll – Production Readiness Implementation Plan

Status: the MVP (PR #1, merged) is functionally complete but is a prototype in three
important ways: **detection only observes `window` scroll**, **all runtime state is lost
when the MV3 service worker suspends or the page reloads**, and **there is no test suite,
build, or release pipeline**. This plan closes those gaps and takes the extension to a
Chrome Web Store submission.

Effort is expressed in **Devin sessions** (one session ≈ a focused chunk of work, not a
human-day). Total build effort: **7–9 sessions**. The critical path to submission is
gated by external waits (Web Store review 1–5 business days, privacy-policy hosting),
not by engineering time.

---

## 0. Gap analysis of the current code

| #   | Gap                                                                                                                                                                                                       | Where                             | Severity                     | Phase |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------- | ----- |
| G1  | Only `window` scroll is observed. YouTube Shorts, Instagram Reels and Reddit's newer UI scroll an **inner container**, so the extension records ~0 active seconds on exactly the most addictive surfaces. | `contentScript.js` `onScroll`     | **Blocker**                  | 1     |
| G2  | `quietUntil`, `activeSeconds` and break mode live in a JS closure. A reload (or an SPA soft-navigation that re-injects) resets the cooldown → the user can be re-nudged immediately after dismissing.     | `contentScript.js` `state`        | **Blocker**                  | 1     |
| G3  | Per-tab sessions live in a `Map` in the worker. MV3 kills the worker after ~30s idle, so `sessions` silently empties; session data is effectively fictional.                                              | `service_worker.js` `sessions`    | High                         | 1     |
| G4  | `SCROLL_TICK` writes storage every 10s **per tab**. With several feed tabs open this approaches `MAX_WRITE_OPERATIONS_PER_MINUTE` (120) and burns disk I/O all day.                                       | `service_worker.js` `updateToday` | High                         | 2     |
| G5  | `writeQueue` serialises writes _within one worker lifetime_. After a worker restart mid-flight, a read-modify-write can still clobber a concurrent one. No atomic increment.                              | `service_worker.js`               | Medium                       | 2     |
| G6  | No schema version on `settings`/`stats`; a future shape change corrupts existing users' data with no migration path.                                                                                      | storage                           | High (ship-blocking, cheap)  | 1     |
| G7  | Day rollover uses the local date at write time. A session spanning midnight attributes all time to the new day; DST and timezone travel are untested.                                                     | `dateKey`                         | Low                          | 2     |
| G8  | Overlay is not keyboard accessible: no focus management, no `Esc`, no focus trap, buttons unreachable if the page steals focus. Fails a11y review.                                                        | `contentScript.js` `buildOverlay` | High                         | 3     |
| G9  | Overlay can appear over fullscreen video and during typing in a composer, i.e. exactly when it is most annoying.                                                                                          | `contentScript.js` `showOverlay`  | High                         | 3     |
| G10 | Break mode blurs `body` via a `<style>` tag; if the page is torn down mid-break the class is orphaned and the feed stays blurred. No persistence of break end time.                                       | `startBreak`                      | Medium                       | 3     |
| G11 | All copy is hard-coded English; no `_locales`. Web Store listing quality and reach suffer.                                                                                                                | everywhere                        | Medium                       | 4     |
| G12 | Zero tests, no linting, no CI, no packaging script. Nothing prevents a regression from shipping.                                                                                                          | repo                              | **Blocker for "production"** | 5     |
| G13 | No privacy policy, no permission justifications, no store assets. Submission will be rejected.                                                                                                            | repo                              | Blocker for submission       | 6     |
| G14 | `activeTab` and `scripting` permissions are declared but never used — reviewers flag unused permissions.                                                                                                  | `manifest.json`                   | Medium                       | 6     |

---

## Phase 1 — Correctness of detection and state (2 sessions)

Goal: the extension actually measures what it claims to, and its state survives worker
suspension and page reloads.

### 1.1 Capture-phase, container-aware scroll detection (G1)

Replace the `window`-only listener with a capture-phase document listener plus intent
signals, so inner scroll containers and virtualised feeds are covered:

```js
// scroll events do not bubble, but they DO capture
document.addEventListener('scroll', onScroll, { capture: true, passive: true });
// intent signals: Shorts/Reels advance without firing scroll at all
for (const type of ['wheel', 'touchmove', 'keydown']) {
  /* Space, ArrowDown, j/k */
}
```

Add a per-site adapter module so quirks live in one place:

```
src/content/sites/
  index.js        // resolve adapter by hostname + pathname
  youtube.js      // isShorts(), scrollRoot(), isFullscreenVideo()
  reddit.js       // shreddit inner container
  instagram.js    // reels container
  twitter.js      // window scroll (default)
```

Each adapter exposes `{ id, isFeedSurface(), scrollRoots(), shouldSuppressOverlay() }`.
Default adapter = current window behaviour, so unsupported paths degrade gracefully.

**Additional signal for virtualised feeds:** where `scrollTop` does not change (Shorts),
count "advance" events (keyboard/wheel/touch) as active seconds via the same accumulator.

- Acceptance: on each of the four sites, 60s of manual scrolling records 55–60 active
  seconds (measured via the popup); 60s of reading records 0.

### 1.2 Persist runtime state in `chrome.storage.session` (G2, G3)

`chrome.storage.session` is in-memory, cleared on browser restart, and survives worker
suspension — the correct home for both the content script's quiet state and the worker's
per-tab sessions.

```js
// key per tab+site so multiple feed tabs don't share a cooldown
const key = `runtime:${tabId}:${site}`; // { quietUntil, activeSeconds, breakUntil }
```

Note: `chrome.storage.session` is **not** readable from content scripts by default — the
worker must call `chrome.storage.session.setAccessLevel({ accessLevel:
'TRUSTED_AND_UNTRUSTED_CONTEXTS' })` on startup, or the content script must proxy through
messages. Prefer the access-level call (fewer round-trips) and keep nothing sensitive there.

Content script reads its runtime record on injection (covers reload + SPA re-injection)
and writes on every state transition (nudge shown, action taken), not every tick.

Worker `sessions` map becomes a `storage.session` read-modify-write, rehydrated lazily,
pruned in `tabs.onRemoved`.

- Acceptance: dismiss a nudge, reload the page → no nudge until the cooldown expires.
  Force-stop the worker in `chrome://extensions` → stats and sessions are intact.

### 1.3 Schema versioning + migrations (G6)

Introduce `schemaVersion` on both storage roots and a `migrations.js` with an ordered
list of `{ from, to, migrate(data) }`, run once in `runtime.onInstalled` (`reason ===
'update'`) and defensively on first read. Ship v1 now so v2 has somewhere to hook.

---

## Phase 2 — Storage, quotas and aggregation (1 session)

### 2.1 Batch and coalesce writes (G4, G5)

- Content script keeps its unreported seconds locally and flushes **every 60s** (or on
  `pagehide`/`visibilitychange`) instead of every 10s.
- Worker accumulates deltas in memory and commits with a **`chrome.alarms` alarm every
  60s**, plus an immediate commit on `onSuspend`. Alarms are the MV3-safe timer; a
  `setTimeout` longer than the worker lifetime is not guaranteed to run.
- Guard every commit with a single `writeQueue` **and** a re-read inside the queue so a
  worker restart cannot clobber.
- Target: ≤ 2 storage writes/minute regardless of open tab count.

### 2.2 Day-boundary correctness (G7)

Attribute seconds to the day they were _accrued_ in: the content script stamps each flush
with its own `dateKey`, and the worker credits that key rather than "today at write time".
Add unit tests for DST forward/backward and a midnight-spanning flush.

### 2.3 Data retention and export

- Keep 14 daily buckets (already), plus a rolling 12-week aggregate for trend display.
- `Export JSON` / `Delete all data` buttons in options (also a privacy-policy requirement).

---

## Phase 3 — UX hardening (1.5 sessions)

### 3.1 Accessibility (G8)

- `role="dialog"`, `aria-modal="false"` (it is a non-blocking nudge), labelled by the title.
- Move focus to the primary button on show; **focus trap** while open; restore focus on close.
- `Esc` = "Remind me later" (the least punishing action).
- Respect `prefers-reduced-motion` (already partly handled by CSS — extend to the break panel).
- Verify AA contrast in both colour schemes.

### 3.2 Suppression rules (G9)

Never show the overlay when:

- `document.fullscreenElement` is set, or the site adapter reports a playing fullscreen video;
- the active element is an editable (`input`, `textarea`, `contenteditable`) — the user is composing;
- a modal/dialog is already open on the page (adapter-provided selector);
- the tab is not visible.

Defer rather than drop: re-evaluate 15s later so the nudge still lands eventually.

### 3.3 Frequency capping

Add `maxInterruptionsPerHour` (default 4) and a hard floor of 60s between nudges,
independent of the cooldown, so no configuration can produce a nagging loop.

### 3.4 Break mode robustness (G10)

- Persist `breakUntil` in `storage.session`; on injection, if `now < breakUntil`, restore
  the break panel — a reload no longer escapes the break.
- Always remove the blur in a `finally`-style teardown (`pagehide`, settings-disabled,
  extension-disabled) so no orphaned blur can survive.
- Make the break length configurable (30s / 1m / 5m).

### 3.5 Popup dashboard polish

Loading / empty / error states, a 7-day sparkline from the weekly aggregate, and the
"you ignored X of Y" line moved to a positively-framed summary.

---

## Phase 4 — Internationalisation (0.5 session, optional for v1)

`_locales/en/messages.json` + `chrome.i18n.getMessage`, `default_locale` in the manifest,
`__MSG_extName__` / `__MSG_extDescription__` placeholders. Even English-only, this is the
prerequisite for adding locales without a refactor, and it removes hard-coded strings from
logic files.

---

## Phase 5 — Quality gates: tests, lint, CI (2 sessions)

### 5.1 Toolchain

- **ESLint** (flat config) + `eslint-plugin-no-unsanitized`, `globals.webextensions`.
- **Prettier**, and **`pre-commit`** running both (the repo has no hooks today).
- Keep the runtime **dependency-free and bundler-free** — the classic-script
  `constants.js` trick is what makes that possible; do not regress it.
- **Type safety without TypeScript**: `// @ts-check` + JSDoc types, checked by `tsc
--noEmit --allowJs --checkJs`. Full TS migration is deliberately out of scope: it would
  force a build step for marginal benefit at this size.

### 5.2 Unit tests (Vitest + `sinon-chrome`-style `chrome` stub)

Pure logic is already isolated in `constants.js` and is the highest-value target:
`dateKey` (DST/timezones), `siteIdForHost` (subdomains, look-alike hosts like
`notreddit.com`), `withDefaults` (partial/corrupt stored settings), `formatDuration`,
`thresholdSeconds` (strict × adaptive interaction, floor at 20s), migrations.

Extract the accumulator into `src/content/detector.js` as a pure, injectable-clock state
machine so the core heuristic is unit-testable without a DOM:

```js
const d = createDetector({ now: fakeClock, settings });
d.onScroll();
fakeClock.advance(1000);
d.tick(); // → { activeSeconds: 1, shouldNudge: false }
```

- Target: ≥ 85% statements on `shared/` and `content/detector.js`.

### 5.3 Integration / E2E (Playwright with a persistent context)

Playwright can load an unpacked MV3 extension and drive the service worker:

```js
const ctx = await chromium.launchPersistentContext(userDataDir, {
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
});
const [worker] = ctx.serviceWorkers();
```

Test against **local fixture pages** that mimic each site's scroll structure (window
scroll, inner container, virtualised advance) — never against the live sites, which are
unauthenticated-hostile, rate-limited and change constantly. Scenarios: nudge fires at
threshold; each of the three buttons; cooldown/snooze respected across reload; per-site
disable; stats reflected in popup; no nudge while typing or fullscreen.

### 5.4 CI (GitHub Actions)

`lint → typecheck → unit → e2e (headless, xvfb) → package` on PR and `main`.
Add a manifest sanity check (JSON parse, every referenced file exists, no MV2 keys) — a
five-line script that would have caught a broken icon path.

---

## Phase 6 — Store submission readiness (1 session + external review wait)

### 6.1 Permissions audit (G14)

Drop `activeTab` and `scripting` — nothing uses them, and unused permissions are a common
rejection/why-do-you-need-this trigger. Final set: `storage`, `alarms`, plus the four host
permissions. Consider moving host permissions to `optional_host_permissions` with an
in-popup "enable for this site" flow: strictly better privacy posture and a smoother
review, at the cost of an onboarding step.

### 6.2 Required collateral

- **Privacy policy** (hosted URL): state plainly that all data stays in
  `chrome.storage.local` on-device, nothing is transmitted, no analytics, no remote code.
- **Single purpose statement** + per-permission justifications for the dashboard.
- **Data safety disclosures**: "does not collect user data" (true today — keep it true).
- Store listing: 128px icon, 1280×800 screenshots (nudge, break, popup, options), small
  promo tile, description.

### 6.3 Release engineering

- Semantic versioning; `version` in the manifest bumped by a release script.
- `CHANGELOG.md`.
- `npm run package` → reproducible `dist/mindful-scroll-<version>.zip` excluding
  `tools/`, tests, CI config.
- Tag-triggered CI job uploading via the Chrome Web Store API (`CWS_CLIENT_ID`,
  `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` as repo secrets), publishing to a **trusted
  tester** track first.
- Rollout: trusted testers → 20% → 100%, watching the Web Store crash/error dashboard.

---

## Phase 7 — Post-launch, explicitly deferred

Listed so they are visible decisions rather than omissions:

- **Firefox / Edge**: MV3 code is largely portable; needs a `browser_specific_settings`
  key and a `browser.*` polyfill. One session, after Chrome ships.
- **`chrome.storage.sync`** for settings across devices (8KB quota — settings fit, stats
  do not). Requires conflict handling; defer.
- **Smarter heuristics**: dwell-time-per-item, scroll-velocity variance, and a
  time-of-day model ("you doomscroll at 23:00") are much better signals than raw seconds,
  but need real usage data to tune. Ship the simple heuristic, instrument it locally,
  revisit.
- **Streaks / weekly report** — engagement features that risk contradicting the product's
  own thesis; evaluate carefully.

---

## Sequencing and risks

```
Phase 1 (detection + state) ──► Phase 2 (storage) ──► Phase 3 (UX) ──┐
                                                                     ├──► Phase 5 (CI) ──► Phase 6 (submit)
                              Phase 4 (i18n, optional) ──────────────┘
```

Phases 1–3 are strictly ordered (each depends on the previous one's state model);
Phase 5's unit-test work can start against `shared/` immediately and in parallel.

| Risk                                                             | Mitigation                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Site DOM changes silently break detection (highest ongoing risk) | Adapters isolated per site + a fallback that always works on `window` scroll; a "detection health" debug view in options showing live active-seconds so breakage is diagnosable in seconds |
| Web Store rejection on permissions/privacy                       | Phase 6.1 audit before submission; consider optional host permissions                                                                                                                      |
| MV3 worker lifecycle surprises                                   | All timers via `chrome.alarms`, all state via `storage.session`, plus an explicit "kill the worker and verify" E2E test                                                                    |
| False positives annoying users into uninstalling                 | Suppression rules + frequency cap (3.2/3.3); default threshold stays conservative at 120s                                                                                                  |

## Definition of done

Detection verified on all four sites including Shorts/Reels; no state lost across worker
suspension, reload or SPA navigation; ≤2 storage writes/min; overlay fully keyboard
accessible and never shown during video/composition; ≥85% unit coverage on core logic with
E2E covering all three overlay actions; CI green on lint, typecheck, unit, E2E and
packaging; privacy policy published, permissions minimal and justified, store listing
complete.
