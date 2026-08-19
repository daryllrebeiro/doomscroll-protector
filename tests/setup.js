/**
 * The extension sources are classic scripts that attach to globalThis, so tests
 * simply import them for their side effect and read MindfulScroll off the global.
 */
import '../src/shared/constants.js';
import '../src/shared/migrations.js';
import '../src/content/detector.js';

export const MS = globalThis.MindfulScroll;
