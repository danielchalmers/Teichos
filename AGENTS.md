# Browser Extension Development Best Practices (TypeScript)

This document outlines absolute best practices for modern, clean TypeScript browser extension development, specifically for Manifest V3 extensions.

## TypeScript Configuration

### Strict Type Safety
- **Enable all strict mode flags** in `tsconfig.json`:
  - `strict: true` - Enable all strict type-checking options
  - `noUncheckedIndexedAccess: true` - Require checking for `undefined` when accessing arrays/objects by index
  - `exactOptionalPropertyTypes: true` - Treat optional properties precisely (distinguishing `undefined` from missing)
  - `noImplicitOverride: true` - Require `override` keyword when overriding methods
  - `noPropertyAccessFromIndexSignature: true` - Enforce bracket notation for index signatures
  - `noUncheckedSideEffectImports: true` - Check that side-effect imports are intentional

### Modern TypeScript Target
- **Target ES2022 or later** for modern features:
  - Top-level await
  - Class fields
  - Private methods/fields
  - Nullish coalescing (`??`)
  - Optional chaining (`?.`)
  - Logical assignment operators (`??=`, `&&=`, `||=`)

### Module System
- **Use ES modules** (`"module": "ES2022"`) with `moduleResolution: "bundler"`
- Configure bundler (webpack/rollup) to handle ES modules properly
- Use `"type": "module"` in manifest.json background section for ES module service workers

## Data Immutability

### Readonly Types
- **Use `readonly` for all interface properties** that shouldn't be mutated:
  ```typescript
  export interface FilterGroup {
    readonly id: string;
    readonly name: string;
    readonly schedules: readonly TimeSchedule[];
    readonly is24x7: boolean;
  }
  ```

### Readonly Arrays
- **Use `readonly T[]`** instead of `T[]` for array properties:
  ```typescript
  readonly filters: readonly Filter[];
  readonly daysOfWeek: readonly number[];
  ```

### Const Assertions
- **Use `as const`** for literal values and constant objects:
  ```typescript
  export const DEFAULT_GROUP_ID = 'default-24x7' as const;
  const STORAGE_KEY = 'pageblock_data' as const;
  ```

### Immutable Updates
- **Use spread operators** for updating data structures:
  ```typescript
  const newData: StorageData = {
    ...data,
    filters: [...data.filters, newFilter],
  };
  ```

## Async/Await Patterns

### Consistent Async Usage
- **Always use async/await** instead of `.then()` chains
- **Properly type Promise return values**:
  ```typescript
  async function loadData(): Promise<StorageData> {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    return result[STORAGE_KEY];
  }
  ```

### Error Handling
- **Use try-catch** for async operations in event handlers:
  ```typescript
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    try {
      const result = await processTab(tab);
    } catch (error) {
      console.error('Error processing tab:', error);
    }
  });
  ```

## Manifest V3 Compliance

### Service Workers
- **Use service workers** instead of background pages
- Service workers have **no DOM access** - all UI must be in separate pages
- Service workers can be **terminated** - design for statelessness
- Store persistent data in `chrome.storage`, not in memory

### Content Security Policy (CSP)
- **Never use inline event handlers** (`onclick`, `onerror`, etc.)
- **Use event delegation** with data attributes:
  ```typescript
  // Good - Event delegation
  element.addEventListener('click', (e) => {
    const action = (e.target as HTMLElement).dataset['action'];
    if (action === 'delete') handleDelete();
  });
  
  // Bad - Inline handler
  element.innerHTML = '<button onclick="handleDelete()">Delete</button>';
  ```

### Permissions
- **Request minimal permissions** - only what's necessary
- Use `host_permissions` for URL access instead of including in `permissions`
- Document why each permission is needed

## Code Organization

### Separation of Concerns
- **Separate business logic from UI code**:
  - `types.ts` - Type definitions and pure functions
  - `storage.ts` - Data persistence layer
  - `background.ts` - Background service worker logic
  - `options.ts`, `popup.ts` - UI-specific code

### Pure Functions
- **Prefer pure functions** that don't mutate inputs:
  ```typescript
  export function isFilterActive(
    filter: Filter, 
    groups: readonly FilterGroup[]
  ): boolean {
    // No mutations, deterministic output
    return filter.enabled && checkGroupSchedule(filter.groupId, groups);
  }
  ```

### Type Exports
- **Export all types** from a central types file
- Use **explicit return types** for public functions
- Avoid type assertions (`as`) when possible

## Error Handling

### Input Validation
- **Validate all external inputs** (URLs, user input, storage data):
  ```typescript
  export function matchesFilter(url: string, pattern: string, isRegex = false): boolean {
    if (isRegex) {
      try {
        const regex = new RegExp(pattern);
        return regex.test(url);
      } catch (error) {
        console.error('Invalid regex pattern:', pattern, error);
        return false;
      }
    }
    return url.toLowerCase().includes(pattern.toLowerCase());
  }
  ```

### Graceful Degradation
- **Provide sensible defaults** when data is missing:
  ```typescript
  const storedData = result[STORAGE_KEY];
  if (!storedData) {
    return getDefaultData();
  }
  ```

### Migration Support
- **Handle backward compatibility** for storage changes:
  ```typescript
  // Ensure whitelist array exists for backwards compatibility
  if (!data.whitelist) {
    return { ...data, whitelist: [] };
  }
  ```

## Testing

### Unit Tests
- **Use Vitest or Jest** for unit testing
- **Mock Chrome APIs** in tests:
  ```typescript
  import { vi } from 'vitest';
  
  const mockStorage = {
    sync: {
      get: vi.fn(),
      set: vi.fn(),
    },
  };
  global.chrome = { storage: mockStorage } as any;
  ```

### Test Coverage
- Test **pure functions** thoroughly
- Test **error cases** and edge cases
- Test **data migrations** and backward compatibility

### Test Organization
- Place tests in `__tests__` directory or `.test.ts` files
- Exclude tests from production builds in `tsconfig.json`

## Build Configuration

### Webpack/Bundler Setup
- **Separate entry points** for each extension page/worker:
  ```javascript
  entry: {
    background: './src/background.ts',
    options: './src/options.ts',
    popup: './src/popup.ts',
  }
  ```

### Production Optimization
- Enable **minification** in production mode
- Use **code splitting** for shared dependencies
- **Copy static assets** (HTML, icons, manifest) to output directory

### Development Experience
- Support **watch mode** for development
- Configure **source maps** for debugging
- Use **TypeScript loader** with webpack

## Security Best Practices

### Input Sanitization
- **Escape HTML** when rendering user content:
  ```typescript
  function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  ```

### Content Security Policy
- Never use `eval()` or `new Function()`
- Never execute user-provided code
- Sanitize all user input before rendering

### Secure Storage
- **Never store secrets** in `chrome.storage.sync` (synced across devices)
- Use `chrome.storage.local` for sensitive data
- Consider encryption for sensitive information

## Code Style

### Naming Conventions
- **PascalCase** for types and interfaces: `FilterGroup`, `TimeSchedule`
- **camelCase** for functions and variables: `loadData`, `isFilterActive`
- **UPPER_SNAKE_CASE** for constants: `DEFAULT_GROUP_ID`, `STORAGE_KEY`

### Function Design
- **Keep functions small** and focused on a single task
- **Prefer explicit over implicit** - clear parameter names and return types
- **Document complex logic** with comments when necessary

### File Organization
- **One main export** per file when possible
- **Group related functionality** together
- **Use barrel exports** (`index.ts`) sparingly

## Linting and Code Quality

### ESLint Configuration
- **Use ESLint** with TypeScript support for static code analysis:
  ```bash
  npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
  ```
- **Configure ESLint** with recommended rules in `eslint.config.js` (flat config) or `.eslintrc.json`:
  ```javascript
  // eslint.config.js (modern flat config)
  import tseslint from '@typescript-eslint/eslint-plugin';
  import tsparser from '@typescript-eslint/parser';
  
  export default [
    {
      files: ['**/*.ts'],
      languageOptions: {
        parser: tsparser,
        parserOptions: {
          project: './tsconfig.json',
        },
      },
      plugins: {
        '@typescript-eslint': tseslint,
      },
      rules: {
        ...tseslint.configs.recommended.rules,
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        '@typescript-eslint/explicit-function-return-type': 'warn',
        '@typescript-eslint/no-explicit-any': 'error',
      },
    },
  ];
  ```
- **Add lint script** to `package.json`:
  ```json
  {
    "scripts": {
      "lint": "eslint src/**/*.ts",
      "lint:fix": "eslint src/**/*.ts --fix"
    }
  }
  ```

### Prettier Configuration
- **Use Prettier** for consistent code formatting:
  ```bash
  npm install -D prettier
  ```
- **Configure Prettier** in `.prettierrc.json`:
  ```json
  {
    "semi": true,
    "trailingComma": "es5",
    "singleQuote": true,
    "printWidth": 100,
    "tabWidth": 2,
    "useTabs": false
  }
  ```
- **Integrate with ESLint** to avoid conflicts:
  ```bash
  npm install -D eslint-config-prettier eslint-plugin-prettier
  ```
- **Add format scripts** to `package.json`:
  ```json
  {
    "scripts": {
      "format": "prettier --write 'src/**/*.{ts,js,json,html}'",
      "format:check": "prettier --check 'src/**/*.{ts,js,json,html}'"
    }
  }
  ```

### VS Code Integration

#### Recommended Extensions
- Create `.vscode/extensions.json` to suggest useful extensions:
  ```json
  {
    "recommendations": [
      "dbaeumer.vscode-eslint",
      "esbenp.prettier-vscode",
      "ms-vscode.vscode-typescript-next"
    ]
  }
  ```

#### Workspace Settings
- Configure `.vscode/settings.json` for automatic formatting and linting:
  ```json
  {
    "editor.formatOnSave": true,
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.codeActionsOnSave": {
      "source.fixAll.eslint": "explicit"
    },
    "typescript.tsdk": "node_modules/typescript/lib",
    "typescript.enablePromptUseWorkspaceTsdk": true,
    "files.exclude": {
      "node_modules": true,
      "dist": true
    }
  }
  ```

#### Launch Configuration
- Set up `.vscode/launch.json` for debugging the extension:
  ```json
  {
    "version": "0.2.0",
    "configurations": [
      {
        "name": "Launch Extension",
        "type": "chrome",
        "request": "launch",
        "url": "chrome://extensions/",
        "webRoot": "${workspaceFolder}/dist"
      }
    ]
  }
  ```

#### Build Tasks
- Configure `.vscode/tasks.json` for quick builds:
  ```json
  {
    "version": "2.0.0",
    "tasks": [
      {
        "label": "Build Extension",
        "type": "npm",
        "script": "build",
        "problemMatcher": ["$tsc"],
        "group": {
          "kind": "build",
          "isDefault": true
        }
      },
      {
        "label": "Watch Extension",
        "type": "npm",
        "script": "watch",
        "problemMatcher": ["$tsc-watch"],
        "isBackground": true
      }
    ]
  }
  ```

### Pre-commit Hooks
- **Use Husky** for Git hooks to enforce quality checks:
  ```bash
  npm install -D husky lint-staged
  npx husky init
  ```
- **Configure lint-staged** in `package.json`:
  ```json
  {
    "lint-staged": {
      "*.ts": ["eslint --fix", "prettier --write"],
      "*.{json,html}": ["prettier --write"]
    }
  }
  ```
- **Add pre-commit hook** in `.husky/pre-commit`:
  ```bash
  #!/bin/sh
  npx lint-staged
  npm test
  ```

## Browser Compatibility

### Feature Detection
- **Check feature availability** before using newer APIs:
  ```typescript
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback implementation
  ```

### Polyfills
- Include polyfills only when necessary
- Document browser support requirements

### Testing Across Browsers
- Test on Chrome, Edge, Firefox (if supporting WebExtensions)
- Use `@types/chrome` or `@types/webextension-polyfill`

## Performance

### Lazy Loading
- Load heavy dependencies only when needed
- Split code by feature for faster initial load

### Efficient Storage
- **Batch storage operations** to reduce API calls
- Use `chrome.storage.sync` for user settings (limited to 100KB total, 8KB per item, 512 items max)
- Use `chrome.storage.local` for larger data (no size limit in most browsers)

### Event Listeners
- **Remove event listeners** when no longer needed
- Use **event delegation** to minimize listeners
- **Debounce/throttle** expensive operations

## Documentation

### Code Documentation
- Document **public APIs** with JSDoc comments
- Explain **non-obvious decisions** in comments
- Keep **README up to date** with features and usage

### Type Documentation
- Use **descriptive type names**
- Add comments to explain complex type relationships
- Document **data formats** and constraints

### User Documentation
- Provide clear **extension description** in manifest
- Include **usage examples** in README
- Document **permissions** and why they're needed

## Version Control

### Commit Practices
- **Small, focused commits** with clear messages
- **Test before committing** code changes
- **Version manifest.json** appropriately

### Gitignore
- Exclude `node_modules/`, `dist/`, build artifacts
- Include configuration files (tsconfig, webpack config)
- Version lock files for reproducible builds

## Deployment

### Release Preparation
- **Update version** in manifest.json and package.json
- **Test production build** thoroughly
- **Verify all assets** are included in dist folder

### Store Submission
- Follow **Chrome Web Store policies**
- Provide clear **privacy policy** if collecting data
- Include **screenshots** and detailed description

## Summary Checklist

When developing a browser extension, ensure:

- ✅ Strict TypeScript with all safety flags enabled
- ✅ Readonly types and immutable data patterns
- ✅ Manifest V3 with service workers
- ✅ No inline event handlers (CSP compliance)
- ✅ Comprehensive error handling and validation
- ✅ Pure functions separated from UI code
- ✅ Unit tests with mocked Chrome APIs
- ✅ Proper async/await usage throughout
- ✅ HTML escaping for user-generated content
- ✅ Minimal permissions requested
- ✅ Production-optimized webpack configuration
- ✅ ESLint and Prettier configured for code quality
- ✅ VS Code workspace settings for automatic formatting
- ✅ Pre-commit hooks for quality enforcement (optional)
- ✅ Clear documentation and code comments
