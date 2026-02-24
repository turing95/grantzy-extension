# Grantzy Extension

Chrome/Chromium Manifest V3 extension that powers the Grantzy side panel flow:
search applications, inspect values, and assist form filling on the active tab.

## Development Commands

- `npm run build`: build side panel bundle
- `npm run lint`: static lint checks on `src/` and tests
- `npm run test`: unit tests for pure modules
- `npm run check`: lint + tests

## Permissions Rationale

The manifest keeps only permissions currently used at runtime.

- `storage`: persist selected application data, recent history, and extension token/settings.
- `sidePanel`: open and control the extension side panel.
- `scripting`: inject `formFiller.content.js` into the active tab before analyze/fill actions.
- `tabs`: read active tab metadata (URL/origin) for permission checks and autofill operations.

Host permissions:

- Required host permissions:
  - `https://grantzy.com/*`
  - `http://localhost/*`
  - `http://127.0.0.1/*`
- Optional runtime-granted host permissions:
  - `http://*/*`
  - `https://*/*`

The optional host permissions are requested only when the user triggers autofill on a site
that is not already covered by required host permissions.

## Smoke Checklist

Use [`docs/smoke-checklist.md`](./docs/smoke-checklist.md) before/after risky changes.
