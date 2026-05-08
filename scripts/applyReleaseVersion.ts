import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

interface VersionedFile {
  version?: string;
}

interface PackageLock extends VersionedFile {
  packages?: Record<string, VersionedFile | undefined>;
}

function normalizeReleaseVersion(input: string | undefined): string {
  if (!input) {
    throw new Error('Expected a release tag or version argument.');
  }

  const tag = input.trim().replace(/^refs\/tags\//, '');
  const version = tag.startsWith('v') ? tag.slice(1) : tag;

  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`Invalid release version: ${input}`);
  }

  return version;
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function writeJsonFile(path: string, data: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

function setVersion(file: VersionedFile, version: string, path: string): void {
  if (typeof file.version !== 'string') {
    throw new Error(`${path} does not contain a version field.`);
  }

  file.version = version;
}

async function applyReleaseVersion(version: string): Promise<void> {
  const packageJsonPath = join(rootDir, 'package.json');
  const packageLockPath = join(rootDir, 'package-lock.json');
  const manifestPath = join(rootDir, 'public/manifest.json');

  const [packageJson, packageLock, manifest] = await Promise.all([
    readJsonFile<VersionedFile>(packageJsonPath),
    readJsonFile<PackageLock>(packageLockPath),
    readJsonFile<VersionedFile>(manifestPath),
  ]);

  setVersion(packageJson, version, 'package.json');
  setVersion(packageLock, version, 'package-lock.json');
  setVersion(manifest, version, 'public/manifest.json');

  const rootPackage = packageLock.packages?.[''];
  if (!rootPackage) {
    throw new Error('package-lock.json is missing the root package entry.');
  }

  setVersion(rootPackage, version, 'package-lock.json packages[""]');

  await Promise.all([
    writeJsonFile(packageJsonPath, packageJson),
    writeJsonFile(packageLockPath, packageLock),
    writeJsonFile(manifestPath, manifest),
  ]);

  console.log(`Applied release version ${version}`);
}

const releaseVersion = normalizeReleaseVersion(process.argv[2] ?? process.env.GITHUB_REF_NAME);

applyReleaseVersion(releaseVersion).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to apply release version: ${message}`);
  process.exit(1);
});
