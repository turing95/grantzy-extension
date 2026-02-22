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
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { success: false, error: 'No response from background' });
    });
  });
}

export function storageGet(keys) {
  return new Promise(resolve => {
    chrome.storage.local.get(keys, data => resolve(data || {}));
  });
}

export function storageSet(payload) {
  return new Promise(resolve => {
    chrome.storage.local.set(payload, () => resolve());
  });
}

export function storageRemove(keys) {
  return new Promise(resolve => {
    chrome.storage.local.remove(keys, () => resolve());
  });
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
