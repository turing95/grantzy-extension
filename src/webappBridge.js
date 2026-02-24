const OPEN_EXTENSION_BUTTON_SELECTOR = '[data-open-grantzy-extension]';
const BUTTON_BUSY_DATA_ATTR = 'extensionBridgeBusy';
const EXTENSION_READY_EVENT = 'grantzy-extension-ready';
const USER_GESTURE_ERROR_PATTERN = /(user gesture|gesture required|may only be called.*gesture)/i;
const SPACE_PATH_PATTERN = /\/spaces\/([0-9a-fA-F-]{36})(?:\/|$)/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TOKEN_LENGTH = 4096;
const BRIDGE_TYPES = Object.freeze({
    connect: 'grantzy-extension-connect',
    disconnect: 'grantzy-extension-disconnect',
    statusRequest: 'grantzy-extension-status-request'
});
const BRIDGE_TYPE_SET = new Set(Object.values(BRIDGE_TYPES));

let pendingOpenRetryPayload = null;
let retryListenersAttached = false;
let warnedOriginCompatibilityFallback = false;

function isRuntimeAvailable() {
    return !!(chrome && chrome.runtime && chrome.runtime.sendMessage);
}

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
    if (!isRuntimeAvailable()) {
        console.warn('Grantzy extension: runtime disconnected, cannot send message. Reload the page.');
        callback({ success: false, response: null, runtimeError: { message: 'Extension context invalidated' } });
        return;
    }

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

function isSameOrigin(origin) {
    return origin === window.location.origin;
}

function isGrantzyOriginFallback(origin) {
    try {
        const url = new URL(origin);
        return url.hostname === location.hostname;
    } catch (_error) {
        return false;
    }
}

function isAllowedMessageOrigin(origin) {
    if (isSameOrigin(origin)) {
        return true;
    }

    if (isGrantzyOriginFallback(origin)) {
        if (!warnedOriginCompatibilityFallback) {
            warnedOriginCompatibilityFallback = true;
            console.warn('Grantzy extension bridge accepted non-exact same-origin message via compatibility fallback.');
        }
        return true;
    }

    return false;
}

function sanitizeToken(rawToken) {
    if (typeof rawToken !== 'string') {
        return '';
    }
    const normalized = rawToken.trim();
    if (!normalized || normalized.length > MAX_TOKEN_LENGTH) {
        return '';
    }
    return normalized;
}

function sanitizeTokenMeta(rawTokenMeta) {
    if (!rawTokenMeta || typeof rawTokenMeta !== 'object') {
        return null;
    }

    return {
        id: rawTokenMeta.id ? String(rawTokenMeta.id) : '',
        name: rawTokenMeta.name ? String(rawTokenMeta.name) : '',
        keyPrefix: rawTokenMeta.keyPrefix ? String(rawTokenMeta.keyPrefix) : '',
        expiresAt: rawTokenMeta.expiresAt ? String(rawTokenMeta.expiresAt) : null
    };
}

function postBridgeResult(type, payload, targetOrigin) {
    window.postMessage({ type, ...payload }, targetOrigin);
}

function handleWindowMessage(event) {
    if (event.source !== window) {
        return;
    }

    if (!event.data || typeof event.data !== 'object') {
        return;
    }

    const { type } = event.data;
    if (!BRIDGE_TYPE_SET.has(type)) {
        return;
    }

    if (!isAllowedMessageOrigin(event.origin)) {
        return;
    }

    if (!isRuntimeAvailable()) {
        const errorResult = { success: false, error: 'Extension context invalidated. Reload the page.' };
        if (type === BRIDGE_TYPES.connect) {
            postBridgeResult('grantzy-extension-connect-result', errorResult, event.origin);
        } else if (type === BRIDGE_TYPES.disconnect) {
            postBridgeResult('grantzy-extension-disconnect-result', errorResult, event.origin);
        } else if (type === BRIDGE_TYPES.statusRequest) {
            postBridgeResult('grantzy-extension-status', { connected: false, user: null, error: errorResult.error }, event.origin);
        }
        return;
    }

    if (type === BRIDGE_TYPES.connect) {
        const token = sanitizeToken(event.data.token);
        if (!token) {
            postBridgeResult('grantzy-extension-connect-result', { success: false, error: 'No token provided' }, event.origin);
            return;
        }

        const tokenMeta = sanitizeTokenMeta(event.data.tokenMeta);
        chrome.runtime.sendMessage({
            action: 'saveExtensionSettings',
            apiToken: token,
            credentialsMode: 'omit',
            tokenMeta: tokenMeta || null
        }, response => {
            const success = !chrome.runtime.lastError && Boolean(response?.success);
            postBridgeResult('grantzy-extension-connect-result', {
                success,
                error: success ? null : (response?.error || chrome.runtime.lastError?.message || 'Unknown error')
            }, event.origin);
        });
        return;
    }

    if (type === BRIDGE_TYPES.disconnect) {
        chrome.runtime.sendMessage({ action: 'clearExtensionToken' }, response => {
            const success = !chrome.runtime.lastError && Boolean(response?.success);
            postBridgeResult('grantzy-extension-disconnect-result', {
                success,
                error: success ? null : (response?.error || chrome.runtime.lastError?.message || 'Unknown error')
            }, event.origin);
        });
        return;
    }

    if (type === BRIDGE_TYPES.statusRequest) {
        chrome.runtime.sendMessage({ action: 'getExtensionSession' }, response => {
            if (chrome.runtime.lastError || !response?.success) {
                postBridgeResult('grantzy-extension-status', {
                    connected: false,
                    user: null,
                    error: response?.error || chrome.runtime.lastError?.message || null
                }, event.origin);
                return;
            }

            const session = response.session || {};
            const user = session.user || null;
            postBridgeResult('grantzy-extension-status', {
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
