import { execSync } from 'node:child_process';

// Builds the extension once before the suite, so the fixtures load a current .output/chrome-mv3
// however the tests were started: `npm run test:e2e`, `npx playwright test`, or VS Code's Playwright
// panel. Dayboard's e2e builds the same way.
export default function globalSetup(): void {
  execSync('npm run build', { stdio: 'inherit' });
}
