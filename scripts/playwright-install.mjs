import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function getPlaywrightVersion() {
  const lockfilePath = join(rootDir, 'package-lock.json');

  if (existsSync(lockfilePath)) {
    const lockfile = readJson(lockfilePath);
    const version = lockfile.packages?.['node_modules/@playwright/test']?.version;

    if (typeof version === 'string' && version.length > 0) {
      return version;
    }
  }

  const packageJson = readJson(join(rootDir, 'package.json'));
  const version = packageJson.devDependencies?.['@playwright/test'];

  if (typeof version === 'string' && version.length > 0) {
    return version;
  }

  throw new Error('Unable to determine the @playwright/test version');
}

const version = getPlaywrightVersion();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(
  npmCommand,
  [
    'exec',
    '--yes',
    `--package=@playwright/test@${version}`,
    '--',
    'playwright',
    'install',
    '--with-deps',
    'chromium',
  ],
  {
    cwd: rootDir,
    stdio: 'inherit',
  }
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
