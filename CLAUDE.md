# CLAUDE.md — Grantzy Extension

Canonical machine-optimized context for this repository.

This repo contains a Chrome/Chromium **Manifest V3** extension named **"Grantzy form assistant"** that **fills web forms with data from Grantzy applications/spaces**.

It provides a **Side Panel** UI as the primary surface, plus content scripts for the grantzy.com web-app bridge and on-demand form filling.

## Working mode: AI-only repo
Only Claude Code works on this codebase. Optimize for:
- **Correctness and speed of iteration**, not readability aesthetics.
- **Grepability**: descriptive names, skip ceremonial docstrings and comments that explain "what". Comment only "why" when non-obvious.
- **Minimal ceremony**: keep diffs small and functional.
- **Tests over docs**: correctness is enforced by tests, not documentation.

## Hard rules (do not break)
- **Testing is mandatory.** Every non-trivial change MUST be verified before declaring done:
  1. `npm run check` (lint + unit tests) must pass.
  2. `npm run test:visual` (Playwright smoke test) must pass — visually confirm screenshots.
  3. For UI/UX changes: add test data to `scripts/test-sidepanel.mjs` that exercises the change, take screenshots, and verify them.
  4. For pure logic changes: add or update unit tests in `tests/*.test.mjs`.
  5. Never skip tests. Never declare a task done without running them.
- **Never assume existing code is correct or optimal.** Every line is fair game for rewrite. If existing code is buggy, fix it — don't build on broken foundations.
- **No parallel implementations.** Before creating something new, check if an existing equivalent exists. Extend it, don't duplicate.
- **No new frameworks/libraries** unless explicitly requested.
- **All user-facing strings in Italian** via `src/i18n.js` using `t()`. No hardcoded strings in JS.
- **Styles live in `styles/sidepanel.css`**, not inline in JS. Side panel HTML has its own `<style>` blocks in `sidepanel.html`.
- **Shared utilities**: use imports from `utils.js` — do NOT duplicate `sendRuntimeMessage`, `storageGet/Set`, `levenshteinDistance`, etc.

## Test infrastructure
| Command | What it does |
|---|---|
| `npm test` | Node.js native test runner (`node --test tests/*.test.mjs`) |
| `npm run lint` | ESLint on `src/**/*.js` and `tests/**/*.test.mjs` |
| `npm run check` | Lint + tests combined |
| `npm run test:visual` | Playwright smoke test — launches Chromium with extension, seeds test data, takes screenshots to `.test-screenshots/` |

- Unit tests use `node:test` + `node:assert/strict`. Files: `tests/*.test.mjs`.
- Visual test script: `scripts/test-sidepanel.mjs`. Seeds `chrome.storage.local` with fake data and screenshots the side panel.
- When adding UI features, extend the visual test's seed data to cover the new feature and verify the screenshot.

---

## End-user context (who uses this & why)

### Primary workflow (Side Panel + Autofill)
The intended end user works in the browser on third-party websites (grant portals, application forms, etc.) and needs to quickly **map and fill form fields with data from a Grantzy "application/space"**.

Typical flow:
1. Open the extension **Side Panel**.
2. Search for and select a Grantzy application ("space") by title/company.
3. Browse a sidebar tree of the application's structured data, or search and click a result to **copy it to clipboard**.
4. Click **Analyze Form** to scan the current page's form fields.
5. Click **Preview** to see AI-matched or fallback field mappings, then adjust as needed.
6. Click **Fill All** to autofill the form. Click **Undo** to revert.

### Secondary surface (grantzy.com bridge)
The `webappBridge.js` content script runs on grantzy.com and handles:
- Opening the side panel from "Open in Extension" buttons on the web app
- Token connect/disconnect via `postMessage` bridge

---

## Architecture overview

### MV3 entry points (`manifest.json`)
- **Side Panel:** `src/sidepanel.html` → loads `dist/sidepanel.js` (webpack bundle)
- **Background service worker** (ES module): `src/background.js`
- **Content script** (grantzy.com only): `src/webappBridge.js`
- **Injected content script** (on-demand, any site): `src/formFiller.content.js` — injected via `chrome.scripting.executeScript`

### Data flow
```
Side Panel UI (sidepanel.js)
  → sendRuntimeMessage({ action })
    → background.js onMessage handler
      → fetch(apiBaseUrl/...) with Bearer token auth
      → chrome.storage.local (selectedApplication, selectedApplicationData, token, mappings)
  → formFiller.content.js (injected by background via executeScript)
    → scans DOM fields / fills values / undo
    → returns results to background → side panel
```

### Key API endpoints
- `fetchApplications` → `GET /api/extension/v1/spaces` (with legacy fallback to `/api/spaces`)
- `fetchApplicationData` → `GET /api/extension/v1/spaces/:id`
- `matchFormFieldsWithAi` → `POST /api/extension/v1/spaces/:id/match-fields`
- `getExtensionFormMappings` / `saveExtensionFormMappings` → `/api/extension/v1/form-mappings`
- `getExtensionSession` → `GET /api/extension/v1/session`
- Token management → `/api/extension/v1/tokens`

### State in `chrome.storage.local`
- `selectedApplication` — `{uuid, title, companyName, updatedAt}`
- `selectedApplicationData` — `{fields, flatFields, updatedAt}`
- `grantzyExtensionApiToken` — Bearer token
- `grantzyExtensionCredentialsMode` — `'omit'` or `'include'`
- `grantzyExtensionTokenMeta` — token metadata
- `grantzyAutofillMappingsV1` — local mapping memory (per-origin, per-form-fingerprint)
- `grantzyRecentApplicationsV1` — recently opened applications

---

## Repo map

```
grantzy-extension/
├── CLAUDE.md
├── manifest.json
├── package.json
├── webpack.sidepanel.js
├── img/
│   └── logo.svg
├── src/
│   ├── background.js          # Service worker — all API calls, message routing, token mgmt
│   ├── sidepanel.html          # Side panel HTML + inline CSS
│   ├── sidepanel.js            # Side panel runtime — state, UI, autofill orchestration
│   ├── searchHandler.js        # Search, ranking, clipboard, results rendering
│   ├── formFiller.content.js   # Content script — form scan, fill, undo (injected on demand)
│   ├── webappBridge.js         # Content script for grantzy.com — side panel opener, token bridge
│   ├── fillPlanner.js          # Local fallback fill plan builder (fuzzy matching)
│   ├── mappingMemory.js        # Local + server mapping memory persistence
│   ├── i18n.js                 # Italian string constants + t() interpolation
│   ├── utils.js                # Shared: normalize, levenshtein, debounce, sendRuntimeMessage,
│   │                           #   storageGet/Set/Remove, toApiOriginLabel, formatRelativeTime,
│   │                           #   addUniqueEventListener
│   ├── env.js                  # (gitignored) API_URL config — copy from env.example.js
│   └── env.example.js          # Template for env.js
└── dist/
    └── sidepanel.js            # Webpack bundle output
```

### Side Panel
- `src/sidepanel.html` — loads `dist/sidepanel.js`, contains all inline CSS
- `src/sidepanel.js` — main UI orchestration:
  - Three views: Applications, Quick Access, Settings
  - Sidebar tree rendering for application field hierarchy
  - Autofill flow: analyze → preview → fill → undo
  - Imports from `searchHandler.js`, `fillPlanner.js`, `mappingMemory.js`, `utils.js`, `i18n.js`

### Background service worker
- `src/background.js` — handles all API calls and message routing
  - Dual-endpoint fallback (extension/v1 → legacy) for backward compat
  - Token storage and management (issue, revoke, rotate)
  - Permission checking and content script injection
  - Returns `true` from `onMessage` listener to keep async channel open

### Content scripts
- `src/webappBridge.js` — runs on `grantzy.com` / `localhost` / `127.0.0.1`
  - Opens side panel from `[data-open-grantzy-extension]` buttons
  - Handles `postMessage` for connect/disconnect/status
- `src/formFiller.content.js` — injected on-demand into any permitted tab
  - Discovers form fields (native inputs, textareas, selects + Ant Design, MUI, React Select, ARIA comboboxes)
  - Fills values with proper event dispatching
  - Supports undo (stores previous state per session)
  - Bootstrap guard prevents re-execution on re-injection

---

## Local setup

### Prerequisites
- Node.js + npm

### Install
```bash
npm install
```

### Configure API URL (required)
Copy `src/env.example.js` to `src/env.js` and set your API URL:
```bash
cp src/env.example.js src/env.js
```

`manifest.json` declares host permissions for `https://grantzy.com/`. If you change `API_URL`, update `host_permissions` accordingly.

---

## Build

```bash
npm run build          # production bundle
npm run build:dev      # development bundle (with source maps)
npm run build:watch    # development + watch mode
```

Output: `dist/sidepanel.js`

Note: `formFiller.content.js` and `webappBridge.js` are NOT bundled — they are loaded directly as source files by the manifest and `executeScript`.

---

## Run locally

1. Run `npm run build` to generate `dist/sidepanel.js`.
2. Chrome → `chrome://extensions` → enable Developer mode.
3. "Load unpacked" → choose this directory.

### Smoke test
- Open the side panel → confirm "Pratiche Grantzy" heading appears
- Search and select an application → sidebar tree renders
- Click a field value → copies to clipboard
- ArrowUp/ArrowDown/Enter work in results lists
- Navigate to any form page → Analyze Form → Preview → Fill All → Undo

---

## Common pitfalls

- **MV3 async messaging:** return `true` from `onMessage` for async `sendResponse`.
- **Permissions vs API_URL:** keep `host_permissions` aligned with API URL.
- **State keys:** the side panel reacts to `chrome.storage.onChanged` for `selectedApplication` and `selectedApplicationData`.
- **Shared utilities:** use imports from `utils.js` — do NOT duplicate `sendRuntimeMessage`, `storageGet/Set`, `levenshteinDistance`, etc.
- **Content script injection:** `formFiller.content.js` is injected via `executeScript` — it cannot use ES module imports.
- **Inline CSS:** all side panel styles live in `sidepanel.html` as inline `<style>` blocks.

---

## How to change behavior

| Area | File(s) |
|------|---------|
| API integration / message routing | `src/background.js` |
| Side panel layout & static UI | `src/sidepanel.html` |
| Side panel runtime & autofill orchestration | `src/sidepanel.js` |
| Search ranking, results, clipboard | `src/searchHandler.js` |
| Form field discovery & filling | `src/formFiller.content.js` |
| Local fallback fill planner | `src/fillPlanner.js` |
| Mapping memory (local + server) | `src/mappingMemory.js` |
| Web app ↔ extension bridge | `src/webappBridge.js` |
| Shared utilities | `src/utils.js` |
| All user-facing strings (Italian) | `src/i18n.js` |
| Bundling | `webpack.sidepanel.js` |

---

## Contribution hygiene

- Keep diffs small and focused.
- After modifying bundled `src/*` files, rebuild with `npm run build`.
- **Run `npm run check` before declaring any task done.** No exceptions.
- **Run `npm run test:visual` for UI changes** and verify screenshots.
- Call out any permission changes in `manifest.json`.
- `env.js` must only contain a non-secret base URL + optional token.
