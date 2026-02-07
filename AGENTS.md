# AGENTS.md

This repo contains a Chrome/Chromium **Manifest V3** extension named **“Grantzy fill form”** whose stated purpose is to **fill forms with Grantzy data**.

It provides a **Side Panel** UI as the primary surface, and also includes an **optional in-page overlay widget** via a content script.

---

## End-user context (who uses this & why)

### Primary “final user” workflow (Side Panel)
The intended end user is someone working in the browser (often on third-party websites) who needs to quickly **look up values from a Grantzy “application/space” and copy them into form fields**.

Typical flow:
1) Open the extension **Side Panel**.
2) Search for and select a Grantzy application (“space”) by title/company.
3) Browse a sidebar tree of the application’s structured data.
4) Search within that data and click a result to **copy it to clipboard**.
5) Paste into the form the user is completing.

The UX favors “lookup + copy” rather than full auto-fill.

### Secondary surface (optional in-page overlay widget)
The repository also contains an injected overlay widget that can appear on pages and provides similar search/copy behavior. If your product direction is “side-panel only”, treat this as legacy/optional and keep changes consistent with the manifest.

---

## Architecture overview

### MV3 entry points
- `manifest.json`
  - Side Panel: `src/sidepanel.html`
  - Background service worker (ES module): `src/background.js`
  - Content script bundle: `dist/bundle.js` (built from `src/main.js`)
  - Content script CSS: `styles/content.css`

### Data flow
UI modules send messages to the background service worker:
- `fetchApplications` → fetch `${API_URL}/api/spaces`
- `fetchApplicationData` → fetch `${API_URL}/api/spaces/:id`

The UI stores state in `chrome.storage.local`:
- `selectedApplication` (uuid/title/companyName)
- `selectedApplicationData` (fields)

### Shared search & results behavior
Both side panel and overlay reuse `src/searchHandler.js` which implements:
- Application search (ranked by relevance)
- Data search (flattening nested fields + ranked matching)
- Keyboard navigation (ArrowUp/ArrowDown/Enter)
- Click-to-copy via `navigator.clipboard`

---

## Repo map

### Side Panel
- `src/sidepanel.html`
  - Loads `../dist/sidepanel.js`
  - Contains the widget skeleton: header, back button, search input, results container
  - Includes inline styles for the side panel layout
- `src/sidepanel.js`
  - Wires the side panel DOM to `searchHandler.js`
  - Renders a sidebar tree and only displays non-leaf nodes (nodes with children)
  - Updates UI when `chrome.storage.local` changes

### Background service worker
- `src/background.js`
  - Imports `./env.js` for `API_URL` (see setup notes below)
  - Handles `chrome.runtime.onMessage` for the two fetch actions
  - **Important MV3 detail:** returns `true` to keep the message channel open for async `sendResponse`

### Content script overlay (optional)
- `src/main.js`
  - Attaches global key handlers and uses a `MutationObserver` to attach listeners to added nodes
- `src/eventManager.js`
  - Opens the overlay widget on `Alt+Q` (and also when an input/textarea ends with `//`)
- `src/widget.js`
  - Shadow DOM overlay widget UI
  - Imports `styles/content.css` as a string via webpack and applies it with `adoptedStyleSheets`
- `styles/content.css`
  - Styling for the overlay widget (not the side panel)

### Build configuration
- `webpack.config.js`
  - Entry: `./src/main.js` → output: `dist/bundle.js`
  - CSS handled with `type: 'asset/source'` (CSS imported as a string)
- `webpack.sidepanel.js`
  - Entry: `./src/sidepanel.js` → output: `dist/sidepanel.js`

---

## Local setup

### Prereqs
- Node.js + npm.

### Install
```bash
npm install
````

### Configure API URL (required)

`src/background.js` imports `./env.js` for `API_URL`.

Create `src/env.js` locally (this file may not be committed in the repo) with:

```js
export default {
  API_URL: "https://grantzy.com"
};
```

⚠️ **Important:** `manifest.json` declares host permissions for `https://grantzy.com/`.
If you set `API_URL` to another domain, you must also update `host_permissions` accordingly
or fetches from the service worker may fail due to missing permissions.

---

## Build

The repo does not define build scripts in `package.json` (only a placeholder `test`).
Use `npx` directly:

```bash
# content script bundle
npx webpack --config webpack.config.js

# side panel bundle
npx webpack --config webpack.sidepanel.js
```

Watch mode (optional):

```bash
npx webpack --config webpack.config.js --watch
npx webpack --config webpack.sidepanel.js --watch
```

Note: both webpack configs default to `mode: 'production'`. Switch to development if you need better debugging.

---

## Run locally (manual testing)

1. Build both bundles (so `dist/bundle.js` and `dist/sidepanel.js` exist).
2. Chrome → `chrome://extensions` → enable Developer mode.
3. “Load unpacked” → choose the repo directory.

### Side Panel smoke test

* Open the extension side panel.
* Confirm you see “Grantzy Applications”.
* Search and select an application.
* Confirm the sidebar tree appears and results render.
* Click a result value and confirm it copies to clipboard.
* Confirm ArrowUp/ArrowDown/Enter work in results lists.

### Overlay smoke test (if enabled)

* On any page with an input/textarea, press `Alt+Q` to open the overlay widget.
* Confirm it shows/hides properly and copy-to-clipboard works.

---

## Common pitfalls / gotchas

* **MV3 async messaging:** if you add new background message actions, ensure you keep the message channel open for async responses (return `true`).
* **Permissions vs API_URL:** keep `host_permissions` aligned with `API_URL`.
* **State keys:** side panel UI reacts to `chrome.storage.local` keys `selectedApplication` and `selectedApplicationData`.
* **Listener duplication:** search code stores listeners on DOM nodes (e.g., `_applicationSearchListener`, `_dataSearchAttached`). Be careful not to attach duplicates.
* **Performance:** the content script uses a `MutationObserver` and attaches key listeners broadly. If you expand overlay behavior, keep performance in mind.
* **Two style systems:** side panel uses inline CSS in `sidepanel.html`; overlay uses `styles/content.css` imported through webpack.

---

## How to change behavior (quick pointers)

* API integration / message routing: `src/background.js`
* Side panel layout & static UI: `src/sidepanel.html`
* Side panel runtime behavior & tree rendering: `src/sidepanel.js`
* Search ranking, flattening, keyboard selection, click-to-copy: `src/searchHandler.js`
* Overlay triggers: `src/eventManager.js`
* Overlay widget UI (Shadow DOM): `src/widget.js`
* Bundling outputs: `webpack.config.js`, `webpack.sidepanel.js`

---

## Contribution hygiene (for automated agents)

When making changes:

* Keep diffs small and focused.
* Prefer updating shared logic in `searchHandler.js` if it affects both side panel and overlay.
* After modifying `src/*` that is bundled, rebuild webpack outputs before testing.
* Call out any permission changes in `manifest.json` in your PR description.
* Avoid adding secrets. `env.js` must only contain a non-secret base URL.
* Validate: side panel search/select, tree rendering, data search, clipboard copy, keyboard navigation.

---

## Release checklist (manual)

* Bundles build cleanly (`dist/bundle.js`, `dist/sidepanel.js`).
* Side panel works end-to-end against the configured API.
* Clipboard works on stable Chrome.
* No console errors in background service worker.
* Permissions are minimal and correct for the deployed API URL.
