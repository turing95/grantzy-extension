const OPEN_EXTENSION_BUTTON_SELECTOR = '[data-open-grantzy-extension]';
const BUTTON_BUSY_DATA_ATTR = 'extensionBridgeBusy';
const EXTENSION_READY_EVENT = 'grantzy-extension-ready';

function announceExtensionAvailability() {
    document.documentElement.dataset.grantzyExtensionInstalled = '1';
    window.dispatchEvent(new CustomEvent(EXTENSION_READY_EVENT));
}

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

function isGrantzyOrigin(origin) {
    try {
        const url = new URL(origin);
        return url.hostname === location.hostname;
    } catch (_error) {
        return false;
    }
}

function handleWindowMessage(event) {
    if (!event.data || typeof event.data !== 'object') {
        return;
    }

    if (!isGrantzyOrigin(event.origin)) {
        return;
    }

    const { type } = event.data;

    if (type === 'grantzy-extension-connect') {
        const { token, tokenMeta } = event.data;
        if (!token) {
            window.postMessage({ type: 'grantzy-extension-connect-result', success: false, error: 'No token provided' }, event.origin);
            return;
        }

        chrome.runtime.sendMessage({
            action: 'saveExtensionSettings',
            apiToken: token,
            credentialsMode: 'omit',
            tokenMeta: tokenMeta || null
        }, response => {
            const success = !chrome.runtime.lastError && Boolean(response?.success);
            window.postMessage({
                type: 'grantzy-extension-connect-result',
                success,
                error: success ? null : (response?.error || chrome.runtime.lastError?.message || 'Unknown error')
            }, event.origin);
        });
        return;
    }

    if (type === 'grantzy-extension-disconnect') {
        chrome.runtime.sendMessage({ action: 'clearExtensionToken' }, response => {
            const success = !chrome.runtime.lastError && Boolean(response?.success);
            window.postMessage({
                type: 'grantzy-extension-disconnect-result',
                success,
                error: success ? null : (response?.error || chrome.runtime.lastError?.message || 'Unknown error')
            }, event.origin);
        });
        return;
    }

    if (type === 'grantzy-extension-status-request') {
        chrome.runtime.sendMessage({ action: 'getExtensionSession' }, response => {
            if (chrome.runtime.lastError || !response?.success) {
                window.postMessage({
                    type: 'grantzy-extension-status',
                    connected: false,
                    user: null,
                    error: response?.error || chrome.runtime.lastError?.message || null
                }, event.origin);
                return;
            }

            const session = response.session || {};
            const user = session.user || null;
            window.postMessage({
                type: 'grantzy-extension-status',
                connected: true,
                user: user ? { name: user.name, email: user.email } : null
            }, event.origin);
        });
        return;
    }
}

announceExtensionAvailability();
document.addEventListener('click', onDocumentClick, true);
window.addEventListener('message', handleWindowMessage, false);
