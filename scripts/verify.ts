import { access, readFile } from 'fs/promises';
import { constants } from 'fs';

const requiredDistFiles = [
  'dist/manifest.json',
  'dist/background/index.js',
  'dist/blocked/index.js',
  'dist/blocked/index.html',
  'dist/options/index.js',
  'dist/options/index.html',
  'dist/popup/index.js',
  'dist/popup/index.html',
];

const requiredSourceFiles = [
  'src/shared/types/index.ts',
  'src/shared/api/storage.ts',
  'src/background/index.ts',
  'src/options/index.ts',
  'src/blocked/index.ts',
  'src/popup/index.ts',
  'tsconfig.json',
  'scripts/build.ts',
];

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function requirePath(path: string): Promise<void> {
  if (await pathExists(path)) {
    console.log(`OK ${path} exists`);
    return;
  }

  throw new Error(`${path} missing`);
}

async function verify(): Promise<void> {
  console.log('Teichos Extension Verification');
  console.log('=================================');
  console.log('');

  await requirePath('dist');

  for (const file of requiredDistFiles) {
    await requirePath(file);
  }

  console.log('');
  console.log('Checking manifest.json...');

  const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8')) as {
    manifest_version?: unknown;
    permissions?: unknown;
  };

  if (manifest.manifest_version !== 3) {
    throw new Error('Invalid manifest version');
  }

  console.log('OK Manifest v3 format');

  if (!Array.isArray(manifest.permissions) || !manifest.permissions.includes('storage')) {
    throw new Error('Storage permission missing');
  }

  console.log('OK Storage permission present');

  if (!manifest.permissions.includes('webNavigation')) {
    throw new Error('webNavigation permission missing');
  }

  console.log('OK webNavigation permission present');

  console.log('');
  console.log('Checking source files...');

  for (const file of requiredSourceFiles) {
    await requirePath(file);
  }

  console.log('');
  console.log('=================================');
  console.log('All checks passed.');
  console.log('');
  console.log('To load the extension:');
  console.log('1. Open Edge and go to edge://extensions/');
  console.log("2. Enable 'Developer mode'");
  console.log("3. Click 'Load unpacked'");
  console.log("4. Select the 'dist' folder");
  console.log('');
}

verify().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Verification failed: ${message}`);
  process.exit(1);
});
