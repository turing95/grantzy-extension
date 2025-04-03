import { ApplicationWidget } from './widget.js';
import { isInputOrTextarea } from './utils.js';

// eventManager.js
export function handleGlobalKeyDown(event ){
  // Check for Alt+Q combination
  if (event.altKey && event.code === 'KeyQ') {
    // Only open the widget if one isn’t already open.
    if (!document.querySelector('[data-widget-host]')) {
      // Use the active element as the target for the widget
      const widget = new ApplicationWidget(document.activeElement);
      // Optionally, attach the widget instance to the active element
      document.activeElement._widgetInstance = widget;
      widget.show();
    }
  }

  // Existing logic for inputs or textareas ending with '//'
  const element = event.target;
  if (isInputOrTextarea(element) && element.value && element.value.endsWith('//')) {
    if (!element._widgetInstance) {
      const widget = new ApplicationWidget(element);
      element._widgetInstance = widget;
      widget.show();
    }
  }
}

function addKeyUpListener(element) {
  if (!element._hasKeyUpListener) {
    element.addEventListener('keydown', handleGlobalKeyDown);
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
  document.addEventListener('keyup', handleGlobalKeyDown);

}