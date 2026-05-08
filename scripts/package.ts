import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');
const artifactsDir = join(rootDir, 'artifacts');
const manifestPath = join(distDir, 'manifest.json');
const ZIP_VERSION = 20;
const STORE_COMPRESSION_METHOD = 0;
const crcTable = buildCrcTable();

type Manifest = {
  version?: string;
};

type ZipEntry = {
  name: string;
  content: Buffer;
  modifiedAt: Date;
};

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}

function calculateCrc32(content: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of content) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]!;
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(value: Date): { date: number; time: number } {
  const year = Math.max(value.getFullYear(), 1980);
  const month = value.getMonth() + 1;
  const day = value.getDate();
  const hours = value.getHours();
  const minutes = value.getMinutes();
  const seconds = Math.floor(value.getSeconds() / 2);

  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  };
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectFiles(path);
      }

      return [path];
    })
  );

  return files.flat().sort((left, right) => left.localeCompare(right));
}

async function createEntries(): Promise<ZipEntry[]> {
  const files = await collectFiles(distDir);

  return Promise.all(
    files.map(async (path) => {
      const [content, fileStat] = await Promise.all([readFile(path), stat(path)]);

      return {
        name: relative(distDir, path).replaceAll('\\', '/'),
        content,
        modifiedAt: fileStat.mtime,
      } satisfies ZipEntry;
    })
  );
}

function createZip(entries: ZipEntry[]): Buffer {
  const fileParts: Buffer[] = [];
  const directoryParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const { date, time } = toDosDateTime(entry.modifiedAt);
    const crc32 = calculateCrc32(entry.content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(ZIP_VERSION, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(STORE_COMPRESSION_METHOD, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc32, 14);
    localHeader.writeUInt32LE(entry.content.length, 18);
    localHeader.writeUInt32LE(entry.content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    fileParts.push(localHeader, name, entry.content);

    const directoryHeader = Buffer.alloc(46);
    directoryHeader.writeUInt32LE(0x02014b50, 0);
    directoryHeader.writeUInt16LE(ZIP_VERSION, 4);
    directoryHeader.writeUInt16LE(ZIP_VERSION, 6);
    directoryHeader.writeUInt16LE(0, 8);
    directoryHeader.writeUInt16LE(STORE_COMPRESSION_METHOD, 10);
    directoryHeader.writeUInt16LE(time, 12);
    directoryHeader.writeUInt16LE(date, 14);
    directoryHeader.writeUInt32LE(crc32, 16);
    directoryHeader.writeUInt32LE(entry.content.length, 20);
    directoryHeader.writeUInt32LE(entry.content.length, 24);
    directoryHeader.writeUInt16LE(name.length, 28);
    directoryHeader.writeUInt16LE(0, 30);
    directoryHeader.writeUInt16LE(0, 32);
    directoryHeader.writeUInt16LE(0, 34);
    directoryHeader.writeUInt16LE(0, 36);
    directoryHeader.writeUInt32LE(0, 38);
    directoryHeader.writeUInt32LE(offset, 42);

    directoryParts.push(directoryHeader, name);
    offset += localHeader.length + name.length + entry.content.length;
  }

  const centralDirectorySize = directoryParts.reduce((size, part) => size + part.length, 0);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...fileParts, ...directoryParts, endOfCentralDirectory]);
}

async function getVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;

  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error('dist/manifest.json is missing a version.');
  }

  return manifest.version;
}

async function removeOldArchives(): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });

  const files = await readdir(artifactsDir);
  await Promise.all(
    files
      .filter((file) => file.startsWith('pageblock-') && file.endsWith('.zip'))
      .map((file) => unlink(join(artifactsDir, file)))
  );
}

async function packageDist(): Promise<void> {
  const version = await getVersion();
  const entries = await createEntries();

  if (entries.length === 0) {
    throw new Error('dist does not contain any files to package.');
  }

  await removeOldArchives();

  const archivePath = join(artifactsDir, `pageblock-${version}.zip`);
  const archive = createZip(entries);
  await writeFile(archivePath, archive);

  console.log(`Created ${relative(rootDir, archivePath)}`);
}

packageDist().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Packaging failed: ${message}`);
  process.exit(1);
});
