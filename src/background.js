import config from './env.js';

const apiBaseUrl = config.API_URL;

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
}

function queryTabs(queryInfo) {
    return new Promise((resolve, reject) => {
        chrome.tabs.query(queryInfo, tabs => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(tabs || []);
        });
    });
}

function permissionsContains(permissions) {
    return new Promise((resolve, reject) => {
        chrome.permissions.contains(permissions, result => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(Boolean(result));
        });
    });
}

function permissionsRequest(permissions) {
    return new Promise((resolve, reject) => {
        chrome.permissions.request(permissions, granted => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(Boolean(granted));
        });
    });
}

function executeScript(tabId, files) {
    return new Promise((resolve, reject) => {
        chrome.scripting.executeScript(
            {
                target: { tabId },
                files
            },
            () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            }
        );
    });
}

function sendMessageToTab(tabId, payload) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, payload, response => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(response);
        });
    });
}

function isScriptableUrl(url) {
    if (!url) {
        return false;
    }

    return url.startsWith('http://') || url.startsWith('https://');
}

function getOriginPattern(url) {
    const parsedUrl = new URL(url);
    return `${parsedUrl.origin}/*`;
}

async function getActiveTab() {
    const tabs = await queryTabs({ active: true, currentWindow: true });
    if (!tabs.length || !tabs[0]?.id) {
        throw new Error('No active tab found');
    }

    return tabs[0];
}

async function ensureTabPermission(tabUrl, requestIfMissing = false) {
    if (!isScriptableUrl(tabUrl)) {
        throw new Error('This page cannot be accessed by the extension. Open a regular website tab and try again.');
    }

    const originPattern = getOriginPattern(tabUrl);
    const permissions = { origins: [originPattern] };
    const hasPermission = await permissionsContains(permissions);

    if (hasPermission) {
        return;
    }

    if (!requestIfMissing) {
        throw new Error('Permission missing for this site. Grant access and try again.');
    }

    const granted = await permissionsRequest(permissions);
    if (!granted) {
        throw new Error('Permission denied for this website. Grant access to use autofill.');
    }
}

async function runTabAutofillAction(tabMessage) {
    const tab = await getActiveTab();
    await ensureTabPermission(tab.url || '', false);
    await executeScript(tab.id, ['src/formFiller.content.js']);

    const response = await sendMessageToTab(tab.id, tabMessage);
    if (!response || response.success === false) {
        throw new Error(response?.error || 'Autofill action failed');
    }

    return {
        ...response,
        tabId: tab.id,
        url: tab.url
    };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    async function handleMessage() {
        if (message.action === 'fetchApplications') {
            const data = await fetchJson(`${apiBaseUrl}/api/spaces`);
            return { success: true, applications: data };
        }

        if (message.action === 'fetchApplicationData' && message.applicationId) {
            const data = await fetchJson(`${apiBaseUrl}/api/spaces/${message.applicationId}`);
            return { success: true, data };
        }

        if (message.action === 'scanFormInActiveTab') {
            return runTabAutofillAction({ action: '__grantzy_scan_form' });
        }

        if (message.action === 'applyFillPlanInActiveTab') {
            return runTabAutofillAction({
                action: '__grantzy_apply_fill',
                planItems: Array.isArray(message.planItems) ? message.planItems : []
            });
        }

        if (message.action === 'undoLastFillInActiveTab') {
            return runTabAutofillAction({ action: '__grantzy_undo_fill' });
        }

        if (message.action === 'getActiveTabInfo') {
            const tab = await getActiveTab();
            if (!isScriptableUrl(tab.url || '')) {
                return {
                    success: true,
                    url: tab.url,
                    scriptable: false
                };
            }

            const originPattern = getOriginPattern(tab.url);
            const hasPermission = await permissionsContains({ origins: [originPattern] });

            return {
                success: true,
                url: tab.url,
                scriptable: true,
                originPattern,
                hasPermission
            };
        }

        return { success: false, error: 'Unknown action' };
    }

    handleMessage()
        .then(result => sendResponse(result))
        .catch(error => {
            console.error('Background action error:', error);
            sendResponse({ success: false, error: error.message || 'Unknown error' });
        });

    return true;
});
