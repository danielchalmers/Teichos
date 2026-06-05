import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const options = parseArgs(process.argv.slice(2));
const chromePath = requiredOption(options, 'chrome');
const profilePath = path.resolve(requiredOption(options, 'profile'));
const extensionPath = path.resolve(requiredOption(options, 'extension'));
const port = Number(requiredOption(options, 'port'));

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid remote debugging port: ${options.get('port') ?? ''}`);
}

if (!existsSync(chromePath)) {
  throw new Error(`Chrome executable does not exist: ${chromePath}`);
}

if (!existsSync(extensionPath)) {
  throw new Error(`Extension dist directory does not exist: ${extensionPath}`);
}

const chromeArgs = [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profilePath}`,
  `--load-extension=${extensionPath}`,
  `--disable-extensions-except=${extensionPath}`,
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  '--enable-unsafe-extension-debugging',
  '--new-window',
  '--disable-session-crashed-bubble',
  '--disable-restore-session-state',
  '--disable-background-mode',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
];

const chrome = spawn(chromePath, chromeArgs, {
  detached: true,
  stdio: 'ignore',
  windowsHide: false,
});
chrome.unref();

const endpoint = `http://127.0.0.1:${port}`;
await waitForDevTools(endpoint);
await resetPageTargets(endpoint);

console.log(`Chrome debug profile is listening on ${endpoint}.`);

function parseArgs(args) {
  const parsed = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value) {
      throw new Error('Expected --key value arguments.');
    }

    parsed.set(key.slice(2), value);
  }

  return parsed;
}

function requiredOption(parsed, key) {
  const value = parsed.get(key);
  if (!value) {
    throw new Error(`Missing required --${key} option.`);
  }

  return value;
}

async function waitForDevTools(endpoint) {
  const deadline = Date.now() + 30_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      await getJson(`${endpoint}/json/version`);
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }

  throw new Error(`Chrome did not expose DevTools on ${endpoint}: ${String(lastError)}`);
}

async function resetPageTargets(endpoint) {
  const freshTarget = await createTarget(endpoint, 'about:blank');
  const keepTargetId = freshTarget.id;
  const targets = await getJson(`${endpoint}/json/list`);
  const pageTargets = targets.filter((target) => target.type === 'page');

  for (const target of pageTargets) {
    if (target.id !== keepTargetId) {
      await closeTarget(endpoint, target.id);
    }
  }

  await fetch(`${endpoint}/json/activate/${encodeURIComponent(keepTargetId)}`).catch(
    () => undefined
  );
}

async function createTarget(endpoint, url) {
  const targetUrl = `${endpoint}/json/new?${encodeURIComponent(url)}`;
  const response =
    (await fetchJsonWithMethod(targetUrl, 'PUT').catch(() => undefined)) ??
    (await fetchJsonWithMethod(targetUrl, 'GET'));

  if (!response?.id) {
    throw new Error('Chrome did not create a fresh debug target.');
  }

  return response;
}

async function closeTarget(endpoint, targetId) {
  const closeUrl = `${endpoint}/json/close/${encodeURIComponent(targetId)}`;
  await fetch(closeUrl).catch(() => undefined);
}

async function getJson(url) {
  return fetchJsonWithMethod(url, 'GET');
}

async function fetchJsonWithMethod(url, method) {
  const response = await fetch(url, { method });
  if (!response.ok) {
    throw new Error(`${method} ${url} failed with ${response.status}`);
  }

  return response.json();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
