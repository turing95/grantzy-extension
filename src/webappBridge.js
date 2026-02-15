const OPEN_EXTENSION_BUTTON_SELECTOR = '[data-open-grantzy-extension]';
const BUTTON_BUSY_DATA_ATTR = 'extensionBridgeBusy';
const EXTENSION_READY_EVENT = 'grantzy-extension-ready';
const USER_GESTURE_ERROR_PATTERN = /(user gesture|gesture required|may only be called.*gesture)/i;
const SPACE_PATH_PATTERN = /\/spaces\/([0-9a-fA-F-]{36})(?:\/|$)/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let pendingOpenRetryPayload = null;
let retryListenersAttached = false;

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

function normalizeUuid(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return UUID_PATTERN.test(normalized) ? normalized : '';
}

function resolveSpaceUuidFromPathname(pathname) {
    const match = String(pathname || '').match(SPACE_PATH_PATTERN);
    return normalizeUuid(match?.[1]);
}

function resolveSpaceUuidFromSidebar() {
    const rightSidebar = document.querySelector('#right-sidebar[data-space-uuid]');
    if (!rightSidebar) {
        return '';
    }

    return normalizeUuid(
        rightSidebar.dataset?.spaceUuid ||
        rightSidebar.getAttribute('data-space-uuid')
    );
}

function resolveCurrentSpaceUuid() {
    return resolveSpaceUuidFromPathname(window.location.pathname) || resolveSpaceUuidFromSidebar();
}

function buildOpenSidePanelPayload() {
    const payload = {
        action: 'openSidePanelFromWebApp',
        pageUrl: window.location.href
    };
    const spaceUuid = resolveCurrentSpaceUuid();
    if (spaceUuid) {
        payload.spaceUuid = spaceUuid;
    }
    return payload;
}

function isGestureRelatedOpenFailure(response, runtimeError) {
    if (response?.requiresUserGesture) {
        return true;
    }

    const message = String(runtimeError?.message || response?.error || '');
    return USER_GESTURE_ERROR_PATTERN.test(message);
}

function sendOpenSidePanelMessage(payload, callback) {
    chrome.runtime.sendMessage(payload, response => {
        const runtimeError = chrome.runtime.lastError;
        callback({
            success: !runtimeError && Boolean(response?.success),
            response: response || null,
            runtimeError: runtimeError || null
        });
    });
}

function detachRetryListeners() {
    if (!retryListenersAttached) {
        return;
    }

    retryListenersAttached = false;
    window.removeEventListener('pointerdown', onQueuedRetryGesture, true);
    window.removeEventListener('keydown', onQueuedRetryGesture, true);
}

function clearQueuedOpenRetry() {
    pendingOpenRetryPayload = null;
    detachRetryListeners();
}

function flushQueuedOpenRetry() {
    const payload = pendingOpenRetryPayload;
    if (!payload) {
        detachRetryListeners();
        return;
    }

    clearQueuedOpenRetry();
    sendOpenSidePanelMessage(payload, ({ success, response, runtimeError }) => {
        if (success) {
            return;
        }

        const errorMessage = String(runtimeError?.message || response?.error || 'Unknown error');
        console.warn('Grantzy extension queued side panel retry failed:', errorMessage);
    });
}

function onQueuedRetryGesture() {
    flushQueuedOpenRetry();
}

function queueOpenRetry(payload) {
    pendingOpenRetryPayload = payload;
    if (retryListenersAttached) {
        return;
    }

    retryListenersAttached = true;
    window.addEventListener('pointerdown', onQueuedRetryGesture, true);
    window.addEventListener('keydown', onQueuedRetryGesture, true);
}

function openSidePanelFromUserClick(button) {
    if (!button || button.dataset[BUTTON_BUSY_DATA_ATTR] === '1') {
        return;
    }

    const payload = buildOpenSidePanelPayload();
    setButtonBusy(button, true);
    sendOpenSidePanelMessage(payload, ({ success, response, runtimeError }) => {
        if (!success && isGestureRelatedOpenFailure(response, runtimeError)) {
            queueOpenRetry(payload);
        } else if (success) {
            clearQueuedOpenRetry();
            if (payload.spaceUuid && response?.preloaded === false) {
                console.warn(
                    'Grantzy extension side panel opened but space preload failed:',
                    response?.preloadError || 'Unknown preload error'
                );
            }
        }

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
