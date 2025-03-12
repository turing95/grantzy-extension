import { ApplicationWidget } from './widget.js';
import { isInputOrTextarea } from './utils.js';

export function handleGlobalKeyUp(event) {
  const element = event.target;
  if (isInputOrTextarea(element) && element.value && element.value.endsWith('//')) {
    // Create and show the widget for this element.
    const widget = new ApplicationWidget(element);
    widget.show();
  }
}

function addKeyUpListener(element) {
  if (!element._hasKeyUpListener) {
    element.addEventListener('keyup', handleGlobalKeyUp);
    element._hasKeyUpListener = true; // Mark to prevent duplicate listeners.
  }
}

export function attachListenersToAllElements(element) {
  addKeyUpListener(element);
  element.querySelectorAll('*').forEach(child => {
    addKeyUpListener(child);
  });
}

export function initEventListeners() {
  // Attach keyup listener on document.
  document.addEventListener('keyup', handleGlobalKeyUp);

}