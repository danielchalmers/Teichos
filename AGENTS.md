# AGENTS.md — TypeScript Browser Extension Development (Manifest V3)

> Best practices for modern, clean TypeScript browser extension development targeting **Chrome** and **Edge** with Manifest V3.

---

## Table of Contents

1. [Guiding Principles](#guiding-principles)
2. [Project Structure](#project-structure)
3. [TypeScript Configuration](#typescript-configuration)
4. [Build Tooling](#build-tooling)
5. [Manifest V3 Patterns](#manifest-v3-patterns)
6. [Testing Strategy](#testing-strategy)
7. [Linting & Code Quality](#linting--code-quality)
8. [VS Code Integration](#vs-code-integration)
9. [Security Best Practices](#security-best-practices)
10. [Cross-Browser Compatibility](#cross-browser-compatibility)
11. [Development Workflow](#development-workflow)
12. [Store Submission](#store-submission)

---

## Guiding Principles

- **Type Safety First**: Leverage TypeScript's strict mode to catch errors at compile time
- **Minimal Permissions**: Request only the permissions your extension absolutely needs
- **Separation of Concerns**: Keep background, content, popup, and options code isolated with shared utilities
- **Test Everything**: Unit test business logic, E2E test user flows
- **Modern Tooling**: Use fast, modern build tools with excellent TypeScript support
- **Security by Default**: Follow MV3 security model strictly; never bypass CSP protections

---

## Project Structure

```
extension/
├── src/
│   ├── background/
│   │   ├── index.ts              # Service worker entry point
│   │   ├── handlers/             # Message and event handlers
│   │   └── services/             # Background-specific services
│   │
│   ├── content/
│   │   ├── index.ts              # Content script entry point
│   │   ├── injected/             # Scripts injected into page context
│   │   └── components/           # DOM manipulation modules
│   │
│   ├── popup/
│   │   ├── index.html
│   │   ├── index.ts
│   │   ├── components/           # UI components
│   │   └── styles/
│   │
│   ├── options/
│   │   ├── index.html
│   │   ├── index.ts
│   │   └── components/
│   │
│   ├── shared/
│   │   ├── types/                # Shared TypeScript interfaces and types
│   │   │   ├── messages.ts       # Message type definitions
│   │   │   ├── storage.ts        # Storage schema types
│   │   │   └── index.ts
│   │   ├── utils/                # Shared utility functions
│   │   ├── constants.ts          # Shared constants
│   │   └── api/                  # Wrapper functions for chrome.* APIs
│   │
│   └── assets/
│       ├── icons/                # Extension icons (16, 32, 48, 128px)
│       ├── images/
│       └── styles/               # Global styles
│
├── public/
│   ├── manifest.json             # Extension manifest
│   └── _locales/                 # i18n message files (if needed)
│
├── test/
│   ├── unit/                     # Unit tests mirroring src/ structure
│   ├── e2e/                      # End-to-end tests
│   ├── fixtures/                 # Test fixtures and mocks
│   └── setup.ts                  # Test setup and chrome.* mocks
│
├── scripts/                      # Build and development scripts
│   ├── build.ts
│   ├── dev.ts
│   └── package.ts
│
├── dist/                         # Build output (gitignored)
│
├── .vscode/
│   ├── extensions.json           # Recommended VS Code extensions
│   ├── launch.json               # Debug configurations
│   ├── tasks.json                # Build tasks
│   └── settings.json             # Workspace settings
│
├── .github/                      # CI/CD workflows (if using GitHub)
│
├── tsconfig.json
├── eslint.config.mjs             # ESLint flat config
├── .prettierrc
├── .gitignore
├── package.json
└── README.md
```

### Key Structural Decisions

- **One entry point per context**: Each context (background, content, popup, options) has a single `index.ts` entry
- **Shared types are critical**: Define message types, storage schemas, and common interfaces in `shared/types/`
- **API wrappers in shared**: Wrap chrome.* APIs with typed, promise-based utilities in `shared/api/`
- **Tests mirror source**: Unit test files should mirror the `src/` directory structure
- **Static assets in public**: Manifest and static files that don't need processing go in `public/`

---

## TypeScript Configuration

### Core Principles

- Enable `strict: true` — non-negotiable for extension development
- Use `noUncheckedIndexedAccess` for safer array/object access
- Target modern ES versions (ES2022+) since Chrome/Edge support them
- Install `@types/chrome` for complete Chrome extension API typings

### Recommended tsconfig.json Settings

| Setting | Value | Rationale |
|---------|-------|-----------|
| `strict` | `true` | Enables all strict type-checking options |
| `target` | `ES2022` | Modern JS features, well-supported by Chrome/Edge |
| `module` | `ESNext` or `preserve` | Let bundler handle module resolution |
| `noEmit` | `true` | Bundler handles transpilation |
| `noUncheckedIndexedAccess` | `true` | Safer array/object access |
| `noImplicitOverride` | `true` | Explicit override keyword for class methods |
| `isolatedModules` | `true` | Required for most bundlers |
| `resolveJsonModule` | `true` | Import JSON files with type safety |
| `esModuleInterop` | `true` | Better CommonJS interop |
| `skipLibCheck` | `true` | Faster compilation |
| `lib` | `["ES2022", "DOM", "DOM.Iterable"]` | Browser environment types |
| `types` | `["chrome"]` | Include Chrome extension types |

### Type Organization

- Define all message types in a central location with discriminated unions
- Create typed storage schemas that match your `chrome.storage` structure
- Export shared types from a barrel file (`shared/types/index.ts`)
- Use branded types for IDs and sensitive strings where appropriate

---

## Build Tooling

### Recommended Bundlers

**Primary Recommendation: esbuild**
- Extremely fast build times
- Excellent TypeScript support out of the box
- Simple configuration
- Good tree-shaking

**Alternative: Vite**
- Great developer experience with HMR (for popup/options pages)
- Built on esbuild for fast builds
- More configuration options
- Better for extensions with complex UI

**Avoid for new projects:**
- Webpack (slower, more complex configuration)
- Parcel (less control over output)

### Build Configuration Essentials

- **Multiple entry points**: Configure separate entries for background, content, popup, options
- **Output structure**: Output files should mirror what manifest.json expects
- **Source maps**: Enable in development, disable or use hidden maps in production
- **Minification**: Enable only for production builds
- **Tree-shaking**: Ensure ES modules are used throughout for effective dead code elimination
- **Target browsers**: Set target to `chrome88` or higher (MV3 minimum)

### Development vs Production

| Aspect | Development | Production |
|--------|-------------|------------|
| Source maps | Enabled (inline or external) | Disabled or hidden |
| Minification | Disabled | Enabled |
| Console statements | Kept | Dropped |
| Watch mode | Enabled | N/A |
| Bundle analysis | Optional | Recommended |

---

## Manifest V3 Patterns

### Service Worker Constraints

Service workers in MV3 are fundamentally different from MV2 background pages:

- **Event-driven**: Service workers terminate when idle; don't rely on persistent state
- **No DOM access**: Cannot access `document`, `window.localStorage`, or any DOM APIs
- **Synchronous listener registration**: Register all event listeners at the top level, synchronously
- **Use chrome.storage**: Replace `localStorage` with `chrome.storage.local` or `chrome.storage.session`
- **Use chrome.alarms**: Replace `setTimeout`/`setInterval` (for delays > 30s) with `chrome.alarms`
- **Use chrome.offscreen**: For DOM operations, create offscreen documents

### Key MV3 APIs

| Purpose | MV2 Approach | MV3 Approach |
|---------|--------------|--------------|
| Background execution | Background page | Service worker |
| Network interception | `webRequest` (blocking) | `declarativeNetRequest` |
| Persistent storage | `localStorage` | `chrome.storage.*` |
| Timers | `setTimeout`/`setInterval` | `chrome.alarms` |
| DOM in background | Direct access | `chrome.offscreen` |
| Remote code | CDN scripts | All code bundled |

### declarativeNetRequest

- Use for blocking, redirecting, or modifying network requests
- Define rules statically in JSON or dynamically via API
- Understand rule limits: ~30,000 dynamic rules, ~5,000 session rules
- Prefer static rules when possible for better performance

### Message Passing

- Define a typed message system with discriminated unions
- Always validate incoming messages before processing
- Use `chrome.runtime.sendMessage` for extension-internal communication
- Use `chrome.tabs.sendMessage` to communicate with specific content scripts
- Handle the case where the receiving end doesn't exist

---

## Testing Strategy

### Unit Testing

**Framework: Vitest (recommended)**
- Fast, native TypeScript support
- Jest-compatible API
- Built-in coverage reporting
- Excellent VS Code integration

**What to Unit Test:**
- Business logic in shared utilities
- Message handlers (with mocked chrome.* APIs)
- State management logic
- Data transformation functions
- Storage serialization/deserialization

**Mocking chrome.* APIs:**
- Create comprehensive mocks in `test/setup.ts`
- Mock `chrome.runtime`, `chrome.storage`, `chrome.tabs`, etc.
- Use vi.fn() or jest.fn() for mock implementations
- Reset mocks between tests

### E2E Testing

**Framework: Playwright (recommended)**
- First-class support for loading extensions
- Can test across Chrome and Edge
- Reliable service worker detection
- Good debugging capabilities

**Alternative: Puppeteer**
- Native Chrome DevTools Protocol access
- Slightly more complex extension loading

**What to E2E Test:**
- Extension installation and activation
- Popup interactions
- Content script injection and behavior
- Background/content script communication
- Options page functionality
- Cross-context workflows

**E2E Test Setup:**
- Load extension in persistent browser context
- Wait for service worker to be ready
- Extract extension ID for constructing chrome-extension:// URLs
- Test against real web pages when necessary

### Test Organization

```
test/
├── unit/
│   ├── background/
│   ├── content/
│   ├── shared/
│   └── popup/
├── e2e/
│   ├── fixtures/           # Playwright fixtures
│   ├── popup.spec.ts
│   ├── content.spec.ts
│   └── integration.spec.ts
├── fixtures/
│   └── chrome-mocks.ts
└── setup.ts
```

---

## Linting & Code Quality

### ESLint Configuration

**Use ESLint 9.x with flat config format (`eslint.config.mjs`)**

**Essential plugins:**
- `@eslint/js` — Core ESLint rules
- `typescript-eslint` — TypeScript-specific rules
- `eslint-plugin-import` — Import/export validation (optional)

**Recommended rule sets:**
- `eslint.configs.recommended`
- `tseslint.configs.strict` — Strict TypeScript rules
- `tseslint.configs.stylistic` — Consistent code style

**Key rules to enable:**
| Rule | Setting | Purpose |
|------|---------|---------|
| `@typescript-eslint/explicit-function-return-type` | warn | Explicit return types for public APIs |
| `@typescript-eslint/no-unused-vars` | error (with `argsIgnorePattern: "^_"`) | Catch unused code |
| `@typescript-eslint/no-explicit-any` | error | Prevent `any` type usage |
| `@typescript-eslint/no-floating-promises` | error | Ensure promises are handled |
| `no-console` | warn (allow `warn`, `error`) | Prevent debug logs in production |

### Prettier Configuration

**Integrate Prettier for consistent formatting:**
- Use `eslint-config-prettier` to disable conflicting ESLint rules
- Configure Prettier via `.prettierrc`
- Format on save in VS Code

**Recommended Prettier settings:**
- `semi`: false or true (team preference)
- `singleQuote`: true
- `trailingComma`: "es5"
- `tabWidth`: 2
- `printWidth`: 100

### Pre-commit Hooks

- Use `husky` + `lint-staged` for pre-commit linting
- Run `eslint --fix` and `prettier --write` on staged files
- Run type checking (`tsc --noEmit`) before commits

---

## VS Code Integration

### Recommended Extensions

Create `.vscode/extensions.json`:

| Extension ID | Purpose |
|--------------|---------|
| `dbaeumer.vscode-eslint` | ESLint integration |
| `esbenp.prettier-vscode` | Prettier formatting |
| `vitest.explorer` | Vitest test runner |
| `ms-vscode.vscode-typescript-next` | Latest TypeScript features |
| `eamodio.gitlens` | Git integration (optional) |
| `bradlc.vscode-tailwindcss` | Tailwind support (if using) |

### Debug Configuration

Create `.vscode/launch.json` with configurations for:

**Chrome with Extension:**
- Type: `chrome`
- Load extension from `${workspaceFolder}/dist`
- Use `--disable-extensions-except` and `--load-extension` flags
- Enable source maps

**Edge with Extension:**
- Type: `msedge`
- Same flags as Chrome
- Useful for testing Edge-specific behavior

**Attach to Browser:**
- Attach debugger to already-running browser instance
- Useful for debugging production builds

### Tasks Configuration

Create `.vscode/tasks.json` with:

| Task | Purpose |
|------|---------|
| Build | Production build |
| Watch/Dev | Development build with watch mode |
| Test | Run unit tests |
| Test:E2E | Run E2E tests |
| Lint | Run ESLint |
| Type Check | Run `tsc --noEmit` |

**Set Build as default build task and Watch as default test task**

### Workspace Settings

Create `.vscode/settings.json`:
- Set Prettier as default formatter
- Enable format on save
- Enable ESLint auto-fix on save
- Configure TypeScript SDK to use workspace version
- Set file associations for JSON files with comments

---

## Security Best Practices

### Content Security Policy (MV3)

MV3 enforces strict CSP:
- **No remote code**: All scripts must be bundled
- **No `eval()` or `new Function()`**: Dynamic code execution is blocked
- **Limited CSP directives**: Only `'self'`, `'wasm-unsafe-eval'`, and localhost (dev only)

### Permissions Philosophy

**Principle of Least Privilege:**
- Request only permissions you actively use
- Prefer `activeTab` over broad host permissions
- Use `optional_permissions` for features that aren't always needed
- Request optional permissions with user context (explain why)

**Permission Categories:**

| Type | When to Use |
|------|-------------|
| `permissions` | Always-required permissions |
| `optional_permissions` | Request at runtime when needed |
| `host_permissions` | URL patterns for content scripts/fetch |
| `optional_host_permissions` | URL access requested at runtime |

### Secure Messaging

- Validate `sender.id` matches your extension ID
- Type-check all incoming messages before processing
- Don't trust content from web pages
- Use structured message types (discriminated unions)
- Sanitize any data that will be rendered to DOM

### Storage Security

- Never store sensitive data in `chrome.storage.sync` (synced to cloud)
- Use `chrome.storage.session` for sensitive session data (encrypted, memory-only)
- Validate data read from storage before use
- Consider encryption for highly sensitive local data

---

## Cross-Browser Compatibility

### Chrome & Edge Compatibility

Edge uses Chromium, so compatibility is high:
- Same extension APIs (chrome.* namespace)
- Same manifest format
- Same packaging (.zip)

**Key Differences:**
- Edge may lag slightly behind Chrome in newest API support
- Some APIs have Edge-specific quirks (check documentation)
- User agent string differs (`Edg/` vs `Chrome/`)

### Compatibility Guidelines

- Test on both Chrome and Edge during development
- Check Edge extension API documentation for any noted limitations
- Avoid Chrome-specific branding in user-facing text
- Use feature detection over browser detection when possible

### Browser Detection (When Necessary)

- Check user agent for `Edg/` to detect Edge
- Prefer feature detection: check if API exists before using
- Wrap browser-specific code in utility functions

---

## Development Workflow

### Local Development

1. Run watch mode: `npm run dev`
2. Load unpacked extension in browser from `dist/` folder
3. Make changes — bundler rebuilds automatically
4. Reload extension in browser (or use extension reloader)

### Hot Reload Options

- **Manual reload**: Click refresh in `chrome://extensions`
- **Extension reloader**: Install a dev extension that reloads on file change
- **Build script integration**: Trigger reload via Chrome DevTools Protocol

### Debugging Tips

- Use Chrome DevTools to debug service worker (inspect from extensions page)
- Use DevTools console in popup/options (right-click > Inspect)
- Use `console.log` strategically in content scripts (visible in page console)
- Enable source maps for readable stack traces

### npm Scripts

Recommended `package.json` scripts:

| Script | Purpose |
|--------|---------|
| `dev` | Start development build with watch mode |
| `build` | Production build |
| `test` | Run unit tests |
| `test:watch` | Run tests in watch mode |
| `test:e2e` | Run E2E tests |
| `test:coverage` | Run tests with coverage |
| `lint` | Run ESLint |
| `lint:fix` | Run ESLint with auto-fix |
| `typecheck` | Run TypeScript type checking |
| `package` | Build and create .zip for submission |
| `clean` | Remove dist/ directory |

### Build Verification

After running a production build, verify the build output using the verification script:

```bash
bash verify.sh
```

This script validates that:
- All required distribution files exist
- Manifest structure is correct
- Required permissions are present
- Source files are intact

This is the same verification process used in the CI workflow to ensure build integrity before deployment.

---

## Store Submission

### Chrome Web Store

**Requirements:**
- Developer account ($5 one-time registration fee)
- Extension packaged as .zip file
- Icons: 128x128 store icon, plus 16, 32, 48, 128 extension icons
- Screenshots and promotional images
- Privacy policy (if requesting sensitive permissions)

**Submission Checklist:**
- [ ] Remove all `console.log` statements (or use build to strip them)
- [ ] Verify manifest version and description
- [ ] Run `bash verify.sh` to verify build output
- [ ] Test production build thoroughly
- [ ] Prepare store listing assets
- [ ] Write clear privacy policy if needed

### Microsoft Edge Add-ons

**Requirements:**
- Microsoft Partner Center account (free)
- Same .zip package as Chrome
- Remove `update_url` from manifest if present
- Don't reference "Chrome" in extension name/description

**Edge-Specific Checklist:**
- [ ] Remove any Chrome-specific branding
- [ ] Test on Edge specifically before submission
- [ ] Prepare Edge-specific screenshots if needed

### Version Management

- Use semantic versioning (MAJOR.MINOR.PATCH)
- Update `version` in manifest.json for each release
- Maintain a CHANGELOG.md
- Tag releases in git

---

## Quick Reference

### File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| TypeScript files | camelCase | `messageHandler.ts` |
| Type definition files | camelCase | `storageTypes.ts` |
| Test files | `*.test.ts` or `*.spec.ts` | `utils.test.ts` |
| Constants | SCREAMING_SNAKE_CASE | `const MAX_RETRIES = 3` |
| Types/Interfaces | PascalCase | `interface StorageSchema` |

### Common Gotchas

1. **Service worker termination**: Don't store state in variables; use `chrome.storage`
2. **Listener registration**: All chrome.* listeners must be registered synchronously at top level
3. **Content script isolation**: Content scripts run in isolated world; use `chrome.scripting.executeScript` for page context
4. **Message response timing**: Return `true` from `onMessage` listener if you'll respond asynchronously
5. **Storage limits**: `chrome.storage.sync` has strict quotas; use `local` for larger data

---

*Last updated: December 2025*
