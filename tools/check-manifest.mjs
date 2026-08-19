/**
 * Manifest sanity check.
 *
 * Catches the class of mistake that only shows up when Chrome refuses to load
 * the unpacked extension: a referenced file that does not exist, a leftover MV2
 * key, a permission we no longer use, or a version drift against package.json.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const errors = [];
const MV2_KEYS = ['background.scripts', 'background.persistent', 'browser_action', 'page_action'];
const ALLOWED_PERMISSIONS = ['storage', 'alarms'];

function fileMustExist(relative, context) {
  if (!relative || existsSync(join(root, relative))) return;
  errors.push(`${context}: missing file "${relative}"`);
}

if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
if (manifest.version !== pkg.version) {
  errors.push(`manifest version ${manifest.version} != package.json version ${pkg.version}`);
}

for (const key of MV2_KEYS) {
  const value = key.split('.').reduce((node, part) => (node ? node[part] : undefined), manifest);
  if (value !== undefined) errors.push(`MV2 key present: ${key}`);
}

for (const permission of manifest.permissions || []) {
  if (!ALLOWED_PERMISSIONS.includes(permission)) {
    errors.push(`unexpected permission "${permission}" — keep the permission set minimal`);
  }
}

fileMustExist(manifest.background && manifest.background.service_worker, 'background');
fileMustExist(manifest.action && manifest.action.default_popup, 'action.default_popup');
fileMustExist(manifest.options_ui && manifest.options_ui.page, 'options_ui.page');

for (const [size, path] of Object.entries(manifest.icons || {})) {
  fileMustExist(path, `icons.${size}`);
}
for (const [size, path] of Object.entries((manifest.action || {}).default_icon || {})) {
  fileMustExist(path, `action.default_icon.${size}`);
}
for (const script of manifest.content_scripts || []) {
  for (const file of script.js || []) fileMustExist(file, 'content_scripts.js');
  for (const file of script.css || []) fileMustExist(file, 'content_scripts.css');
}
for (const entry of manifest.web_accessible_resources || []) {
  for (const file of entry.resources || []) fileMustExist(file, 'web_accessible_resources');
}

// Content scripts are classic scripts loaded in order: constants must come
// first, contentScript.js last, or the globals are not defined when they run.
for (const script of manifest.content_scripts || []) {
  const js = script.js || [];
  if (js[0] !== 'src/shared/constants.js') {
    errors.push('content_scripts.js must load src/shared/constants.js first');
  }
  if (js[js.length - 1] !== 'src/content/contentScript.js') {
    errors.push('content_scripts.js must load src/content/contentScript.js last');
  }
}

if (errors.length) {
  console.error('manifest check failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log('manifest check passed');
