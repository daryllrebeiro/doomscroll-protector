/**
 * Build the Chrome Web Store upload zip.
 *
 * Ships only what the extension needs at runtime — no tooling, tests or CI
 * config — using the platform's own zip so there is no build dependency.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const INCLUDE = ['manifest.json', 'src', 'assets', '_locales'].filter((entry) =>
  existsSync(join(root, entry))
);

const distDir = join(root, 'dist');
const output = join(distDir, `mindful-scroll-${version}.zip`);

rmSync(output, { force: true });
mkdirSync(distDir, { recursive: true });

if (process.platform === 'win32') {
  const items = INCLUDE.map((entry) => `'${join(root, entry)}'`).join(',');
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Compress-Archive -Path ${items} -DestinationPath '${output}'`],
    { stdio: 'inherit' }
  );
} else {
  execFileSync('zip', ['-r', '-q', output, ...INCLUDE], { cwd: root, stdio: 'inherit' });
}

console.log(`packaged ${output}`);
