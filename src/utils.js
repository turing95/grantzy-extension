export function normalizeString(str) {
  return String(str ?? '')
      .toLowerCase()
      .replace(/[\s._-]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
}

export function normalizeTokens(str) {
  return normalizeString(str)
      .split(' ')
      .filter(Boolean);
}

export function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

const _listenerRegistry = new WeakMap();

function wrapChromeCallback(executor, fallbackValue = undefined) {
  return new Promise(resolve => {
    executor((...args) => {
      if (chrome.runtime.lastError) {
        resolve(fallbackValue);
        return;
      }

      if (!args.length) {
        resolve(fallbackValue);
        return;
      }

      resolve(args[0]);
    });
  });
}

export function addUniqueEventListener(element, event, listener, key) {
  if (!_listenerRegistry.has(element)) {
    _listenerRegistry.set(element, new Map());
  }
  const handlers = _listenerRegistry.get(element);
  const listenerKey = key || event;
  if (handlers.has(listenerKey)) {
    element.removeEventListener(event, handlers.get(listenerKey));
  }
  element.addEventListener(event, listener);
  handlers.set(listenerKey, listener);
}

export function sendRuntimeMessage(payload) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(payload, response => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        resolve({ success: false, error: runtimeError.message });
        return;
      }

      resolve(response || { success: false, error: 'No response from background' });
    });
  });
}

export function storageGet(keys) {
  return wrapChromeCallback(
      callback => chrome.storage.local.get(keys, callback),
      {}
  ).then(data => data || {});
}

export function storageSet(payload) {
  return wrapChromeCallback(
      callback => chrome.storage.local.set(payload, callback),
      null
  ).then(() => undefined);
}

export function storageRemove(keys) {
  return wrapChromeCallback(
      callback => chrome.storage.local.remove(keys, callback),
      null
  ).then(() => undefined);
}

export function toApiOriginLabel(rawUrl) {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl).origin;
  } catch (_error) {
    return String(rawUrl);
  }
}

export function formatRelativeTime(timestamp, locale = 'it') {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  const delta = date.getTime() - Date.now();
  const absoluteDelta = Math.abs(delta);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (absoluteDelta < 60_000) return '';
  if (absoluteDelta < 3_600_000) return formatter.format(Math.round(delta / 60_000), 'minute');
  if (absoluteDelta < 86_400_000) return formatter.format(Math.round(delta / 3_600_000), 'hour');
  if (absoluteDelta < 2_592_000_000) return formatter.format(Math.round(delta / 86_400_000), 'day');
  return formatter.format(Math.round(delta / 2_592_000_000), 'month');
}

export function debounce(fn, wait = 200) {
  let timeoutId = null;

  return function debounced(...args) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      fn.apply(this, args);
    }, wait);
  };
}

// --- Scan run page-mapping helpers (used by sidepanel.js) -------------------

const _SCAN_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const _SCAN_LONG_NUMERIC_RE = /\b\d{6,}\b/g;

// Normalize a portal URL so two pages of the same wizard step but with
// different per-instance UUIDs match each other. Smart&Start example:
//   .../domanda/EAE9.../compagine-sociale/4474.../tipo-socio/52B7.../persona-fisica
//   becomes .../domanda/<any>/compagine-sociale/<any>/tipo-socio/<any>/persona-fisica
// Strips query string + trailing slash. Replaces UUIDs and long numeric IDs
// with the wildcard token. Falls back to a best-effort string strip on parse error.
export function normalizeUrlForMatching(rawUrl) {
  if (!rawUrl) return '';
  try {
    const url = new URL(rawUrl);
    let path = url.pathname.replace(_SCAN_UUID_RE, '*').replace(_SCAN_LONG_NUMERIC_RE, '*');
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `${url.origin}${path}`;
  } catch (_err) {
    return String(rawUrl).split('?')[0];
  }
}

/**
 * Return all captures whose URL matches the current URL (after normalization).
 * Each match keeps its operator_context + ts so the UI can show "where" and
 * "when". Matches are ordered as they appear in the captures array.
 */
export function findMatchingCaptures(currentUrl, captures) {
  if (!currentUrl) return [];
  const normalizedCurrent = normalizeUrlForMatching(currentUrl);
  if (!normalizedCurrent) return [];
  const out = [];
  (captures || []).forEach((c, idx) => {
    const cu = c.url || c.URL || '';
    if (normalizeUrlForMatching(cu) === normalizedCurrent) {
      out.push({
        index: c.index || (idx + 1),
        url: cu,
        ts: c.ts || c.timestamp || null,
        operator_context: c.operator_context || '',
      });
    }
  });
  return out;
}
