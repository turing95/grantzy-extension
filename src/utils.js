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

export function addUniqueEventListener(element, event, listener) {
  if (!element._eventListeners) {
    element._eventListeners = new Set();
  }
  const listenerKey = `${event}-${listener.toString()}`;
  if (!element._eventListeners.has(listenerKey)) {
    element.addEventListener(event, listener);
    element._eventListeners.add(listenerKey);
  }
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
