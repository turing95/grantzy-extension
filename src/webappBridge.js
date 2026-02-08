const OPEN_EXTENSION_BUTTON_SELECTOR = '[data-open-grantzy-extension]';
const BUTTON_BUSY_DATA_ATTR = 'extensionBridgeBusy';

function pulseButtonState(button, success) {
    if (!button) {
        return;
    }

    const successClasses = ['ring-2', 'ring-marian-blue-300'];
    const errorClasses = ['ring-2', 'ring-red-300'];
    const classesToAdd = success ? successClasses : errorClasses;
    const classesToRemove = success ? errorClasses : successClasses;

    button.classList.remove(...classesToRemove);
    button.classList.add(...classesToAdd);

    window.setTimeout(() => {
        button.classList.remove(...classesToAdd);
    }, success ? 900 : 1400);
}

function setButtonBusy(button, isBusy) {
    if (!button) {
        return;
    }

    if (isBusy) {
        button.dataset[BUTTON_BUSY_DATA_ATTR] = '1';
    } else {
        delete button.dataset[BUTTON_BUSY_DATA_ATTR];
    }
    button.disabled = isBusy;
}

function openSidePanelFromUserClick(button) {
    if (!button || button.dataset[BUTTON_BUSY_DATA_ATTR] === '1') {
        return;
    }

    setButtonBusy(button, true);
    chrome.runtime.sendMessage({ action: 'openSidePanelFromWebApp' }, response => {
        const success = !chrome.runtime.lastError && Boolean(response?.success);
        setButtonBusy(button, false);
        pulseButtonState(button, success);
    });
}

function onDocumentClick(event) {
    const button = event.target?.closest?.(OPEN_EXTENSION_BUTTON_SELECTOR);
    if (!button) {
        return;
    }

    event.preventDefault();
    openSidePanelFromUserClick(button);
}

document.addEventListener('click', onDocumentClick, true);
