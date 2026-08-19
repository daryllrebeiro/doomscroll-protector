/**
 * Global type declarations for the MindfulScroll extension.
 *
 * The extension ships as classic scripts (no bundler, no ES modules), so
 * TypeScript must treat them as scripts and know about the globals they
 * attach to `globalThis`.
 */

/** The shared namespace attached by src/shared/constants.js. */
interface MindfulScrollShared {
  SCHEMA_VERSION: number;
  SITES: { id: string; label: string; hosts: string[] }[];
  DEFAULT_SETTINGS: Record<string, unknown>;
  STORAGE_KEYS: { settings: string; stats: string };
  MESSAGES: Record<string, string>;
  ACTIONS: string[];
  STRICT_THRESHOLD_FACTOR: number;
  STRICT_QUIET_FACTOR: number;
  ADAPTIVE_STEP: number;
  ADAPTIVE_MIN_FACTOR: number;
  MIN_THRESHOLD_SECONDS: number;
  HISTORY_DAYS: number;
  dateKey(date?: Date | number | string): string;
  siteIdForHost(hostname: string | null | undefined): string | null;
  withDefaults(stored: unknown): Record<string, unknown>;
  emptyDay(): Record<string, unknown>;
  normaliseDay(day: unknown): Record<string, unknown>;
  ignoredCount(day: unknown): number;
  t(key: string, fallback: string, substitutions?: string[]): string;
  formatDuration(totalSeconds: number): string;
  thresholdSeconds(settings: unknown, ignoredToday?: number): number;
  quietMsForAction(settings: unknown, action: string): number;
  analyzePeakUsage(stats: object): object | null;
  formatHour(hour24: number): string;
  generateInsights(stats: object): string[];
  getWeeklySummary(stats: object): object;
}

/** Runtime state restored from storage.session (detector snapshot + break). */
interface DetectorRestored {
  activeSeconds?: number;
  quietUntil?: number;
  nudgeHistory?: number[];
  breakUntil?: number;
}

/** The detector namespace attached by src/content/detector.js. */
interface MindfulScrollDetector {
  createDetector(options: {
    settings: unknown;
    now?: () => number;
    ignoredToday?: number;
    restored?: DetectorRestored;
  }): Detector;
  detectorConstants: { IDLE_GAP_MS: number; RESET_AFTER_IDLE_MS: number; MAX_TICK_MS: number };
}

/** The detector instance returned by createDetector. */
interface Detector {
  setSettings(next: unknown): void;
  setIgnoredToday(count: number): void;
  thresholdSeconds(): number;
  readonly activeSeconds: number;
  readonly quietUntil: number;
  snapshot(): {
    activeSeconds: number;
    quietUntil: number;
    nudgeHistory: number[];
  };
  registerActivity(timestamp?: number): void;
  registerInteraction(): void;
  reset(): void;
  tick(context?: {
    hidden: boolean;
    feedSurface: boolean;
    suppressed: boolean;
    overlayOpen: boolean;
  }): { activeSeconds: number; shouldNudge: boolean; deferred: boolean };
  noteNudgeShown(timestamp?: number): void;
  applyAction(action: string, timestamp?: number): number;
  setQuietUntil(timestamp: number): void;
  takePending(minSeconds?: number): { date: string; seconds: number }[];
}
/** The site registry namespace attached by src/content/sites/index.js. */
interface MindfulScrollSites {
  DEFAULT_ADAPTER: object;
  registerSiteAdapter(adapter: object): void;
  adapterFor(siteId: string): object;
  isFullscreenPlayback(): boolean;
  isComposing(): boolean;
}

/** The migrations namespace attached by src/shared/migrations.js. */
interface MindfulScrollMigrations {
  migrate(settings: unknown, stats: unknown): { settings: object; stats: object; changed: boolean };
  versionOf(settings: unknown): number;
  STEPS: { to: number; migrate: (data: unknown) => unknown }[];
}

interface MindfulScrollGlobal extends MindfulScrollShared, MindfulScrollDetector {
  sites: MindfulScrollSites;
  migrations: MindfulScrollMigrations;
  applyI18n(root?: ParentNode): void;
  /** Allows incremental construction per classic script: constants attaches
   *  the shared part, detector.js attaches createDetector, etc. */
}

declare global {
  interface Window {
    MindfulScroll: MindfulScrollGlobal;
  }
  interface WorkerGlobalScope {
    MindfulScroll: MindfulScrollGlobal;
    importScripts(...urls: string[]): void;
  }
  var MindfulScroll: MindfulScrollGlobal;
}

export {};
