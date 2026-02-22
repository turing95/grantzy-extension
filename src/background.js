import config from './env.js';

const apiBaseUrl = config.API_URL;
const defaultApiToken = config.API_TOKEN || '';
const defaultCredentialsMode = config.API_CREDENTIALS_MODE || 'omit';

const STORAGE_KEYS = {
    apiToken: 'grantzyExtensionApiToken',
    credentialsMode: 'grantzyExtensionCredentialsMode',
    tokenMeta: 'grantzyExtensionTokenMeta'
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SPACE_PATH_PATTERN = /\/spaces\/([0-9a-fA-F-]{36})(?:\/|$)/i;

function storageGet(keys) {
    return new Promise(resolve => {
        chrome.storage.local.get(keys, data => resolve(data || {}));
    });
}

function storageSet(values) {
    return new Promise(resolve => {
        chrome.storage.local.set(values, () => resolve());
    });
}

function sanitizeCredentialsMode(mode) {
    return mode === 'include' ? 'include' : 'omit';
}

function normalizeToken(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function sanitizeOrganizationUuid(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return UUID_PATTERN.test(normalized) ? normalized : '';
}

function extractSpaceUuidFromUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl || '');
        const match = parsed.pathname.match(SPACE_PATH_PATTERN);
        return sanitizeOrganizationUuid(match?.[1]);
    } catch (_error) {
        return '';
    }
}

function toTokenPreview(token) {
    const normalized = normalizeToken(token);
    if (!normalized) {
        return '';
    }

    if (normalized.length <= 14) {
        return normalized;
    }

    return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
}

function sanitizeTokenMeta(meta) {
    if (!meta || typeof meta !== 'object') {
        return null;
    }

    return {
        id: meta.id ? String(meta.id) : '',
        name: meta.name ? String(meta.name) : '',
        keyPrefix: meta.keyPrefix ? String(meta.keyPrefix) : '',
        expiresAt: meta.expiresAt ? String(meta.expiresAt) : null,
        source: meta.source ? String(meta.source) : 'manual',
        createdAt: meta.createdAt ? String(meta.createdAt) : null
    };
}

function buildApiUrl(pathname, query = {}) {
    const url = new URL(pathname, apiBaseUrl);
    Object.entries(query).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') {
            return;
        }
        url.searchParams.set(key, String(value));
    });
    return url.toString();
}

function toApiOriginLabel(rawUrl) {
    try {
        return new URL(rawUrl).origin;
    } catch (_error) {
        return String(rawUrl || '');
    }
}

async function resolveApiRuntime() {
    const data = await storageGet([
        STORAGE_KEYS.apiToken,
        STORAGE_KEYS.credentialsMode,
        STORAGE_KEYS.tokenMeta
    ]);

    const storedToken = normalizeToken(data[STORAGE_KEYS.apiToken]);
    const envToken = normalizeToken(defaultApiToken);
    const activeToken = storedToken || envToken;
    const activeTokenSource = storedToken ? 'storage' : (envToken ? 'env' : 'none');

    return {
        token: activeToken,
        tokenSource: activeTokenSource,
        credentialsMode: sanitizeCredentialsMode(data[STORAGE_KEYS.credentialsMode] || defaultCredentialsMode),
        tokenMeta: sanitizeTokenMeta(data[STORAGE_KEYS.tokenMeta])
    };
}

function createApiHeaders(token, extraHeaders = {}) {
    const headers = {
        Accept: 'application/json',
        ...extraHeaders
    };

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    return headers;
}

async function fetchJson(url, options = {}, requestOverrides = {}) {
    const runtime = await resolveApiRuntime();
    const token = Object.prototype.hasOwnProperty.call(requestOverrides, 'token')
        ? normalizeToken(requestOverrides.token)
        : runtime.token;
    const credentialsMode = Object.prototype.hasOwnProperty.call(requestOverrides, 'credentialsMode')
        ? sanitizeCredentialsMode(requestOverrides.credentialsMode)
        : runtime.credentialsMode;

    const response = await fetch(url, {
        credentials: credentialsMode,
        ...options,
        headers: createApiHeaders(token, options.headers || {})
    });

    if (!response.ok) {
        let detail = '';
        try {
            const errorPayload = await response.json();
            detail = String(
                errorPayload?.detail ||
                errorPayload?.error ||
                ''
            ).trim();
        } catch (_error) {
            detail = '';
        }

        const message = detail ? `${detail} (HTTP ${response.status})` : `HTTP ${response.status}`;
        throw new Error(message);
    }

    return response.json();
}

function normalizeApplicationsResponse(data) {
    const rawItems = Array.isArray(data)
        ? data
        : (Array.isArray(data?.items) ? data.items : []);

    const normalizedItems = [];
    const seen = new Set();
    rawItems.forEach(item => {
        if (!item || typeof item !== 'object') {
            return;
        }

        const uuid = String(item.uuid || item.id || '').trim();
        const title = String(item.title || '').trim();
        const companyName = String(item.company_name || item.companyName || '').trim();
        const updatedAt = item.updated_at || item.updatedAt || null;
        const dedupeKey = uuid || `${title.toLowerCase()}::${companyName.toLowerCase()}`;

        if (dedupeKey && seen.has(dedupeKey)) {
            return;
        }
        if (dedupeKey) {
            seen.add(dedupeKey);
        }

        normalizedItems.push({
            ...item,
            uuid,
            title,
            company_name: companyName,
            updated_at: updatedAt
        });
    });

    if (Array.isArray(data)) {
        return {
            items: normalizedItems,
            nextCursor: null
        };
    }

    if (Array.isArray(data?.items)) {
        return {
            items: normalizedItems,
            nextCursor: data.next_cursor ?? null
        };
    }

    return {
        items: [],
        nextCursor: null
    };
}

function describeHttpError(error, fallbackMessage) {
    const statusMatch = String(error?.message || '').match(/HTTP\s+(\d+)/);
    const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : null;

    if (!status) {
        return fallbackMessage;
    }
    if (status === 401 || status === 403) {
        return 'Authentication failed. Check API token or session access.';
    }
    if (status >= 500) {
        return 'Grantzy backend is temporarily unavailable. Try again shortly.';
    }
    return `${fallbackMessage} (HTTP ${status})`;
}

async function fetchApplicationsFromApi(query, limit, cursor = 0, organizationUuid = '') {
    try {
        const data = await fetchJson(
            buildApiUrl('/api/extension/v1/spaces', {
                q: query,
                limit,
                cursor,
                organization_uuid: organizationUuid
            })
        );
        const normalized = normalizeApplicationsResponse(data);
        return {
            applications: normalized.items,
            nextCursor: normalized.nextCursor,
            source: 'extension_v1'
        };
    } catch (error) {
        const statusMatch = String(error?.message || '').match(/HTTP\s+(\d+)/);
        const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : null;
        if (status === 401 || status === 403 || status >= 500) {
            throw error;
        }

        // Fallback for older backend deployments (404 / method mismatch).
        const legacyData = await fetchJson(buildApiUrl('/api/spaces'));
        const normalizedQuery = String(query || '').toLowerCase().trim();
        const applications = normalizeApplicationsResponse(legacyData).items;

        const filteredApplications = normalizedQuery
            ? applications.filter(application => {
                const title = String(application.title || '').toLowerCase();
                const companyName = String(application.company_name || '').toLowerCase();
                return title.includes(normalizedQuery) || companyName.includes(normalizedQuery);
            })
            : applications;

        const nextSlice = filteredApplications.slice(cursor, cursor + limit);
        const hasMore = cursor + limit < filteredApplications.length;

        return {
            applications: nextSlice,
            nextCursor: hasMore ? cursor + limit : null,
            source: 'legacy'
        };
    }
}

async function fetchApplicationDetailFromApi(applicationId) {
    try {
        return await fetchJson(buildApiUrl(`/api/extension/v1/spaces/${applicationId}`));
    } catch (_error) {
        // Fallback for older backend deployments.
        return fetchJson(buildApiUrl(`/api/spaces/${applicationId}`));
    }
}

function isUserGestureRequirementError(message) {
    const normalized = String(message || '').toLowerCase();
    return normalized.includes('user gesture') || normalized.includes('gesture required');
}

async function preloadSelectedSpace(spaceUuid) {
    const normalizedSpaceUuid = sanitizeOrganizationUuid(spaceUuid);
    if (!normalizedSpaceUuid) {
        return {
            preloaded: false,
            preloadError: null
        };
    }

    try {
        const detail = await fetchApplicationDetailFromApi(normalizedSpaceUuid);
        const fields = Array.isArray(detail?.fields) ? detail.fields : [];
        const hasFlatFields = Array.isArray(detail?.flat_fields);
        const selectedApplicationData = {
            fields,
            updatedAt: detail?.updated_at || null
        };

        if (hasFlatFields) {
            selectedApplicationData.flatFields = detail.flat_fields;
        }

        await storageSet({
            selectedApplication: {
                uuid: normalizedSpaceUuid,
                title: String(detail?.title || '').trim(),
                companyName: String(detail?.company_name || detail?.companyName || '').trim(),
                updatedAt: detail?.updated_at || null
            },
            selectedApplicationData
        });

        return {
            preloaded: true,
            preloadError: null
        };
    } catch (error) {
        console.warn('Failed to preload selected space for side panel open:', error);
        return {
            preloaded: false,
            preloadError: error?.message || 'Could not preload selected space.'
        };
    }
}

async function matchFormFieldsWithAiFromApi({
    applicationId,
    origin = '',
    url = '',
    formFingerprint = '',
    fields = [],
    memoryHints = []
} = {}) {
    if (!applicationId) {
        throw new Error('Application id is required for AI field matching.');
    }

    const payload = {
        origin: String(origin || ''),
        url: String(url || ''),
        form_fingerprint: String(formFingerprint || ''),
        fields: Array.isArray(fields) ? fields : [],
        memory_hints: Array.isArray(memoryHints) ? memoryHints : []
    };

    return fetchJson(
        buildApiUrl(`/api/extension/v1/spaces/${applicationId}/match-fields`),
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        }
    );
}

async function fetchExtensionFormMappingsFromApi({
    origin = '',
    formFingerprint = ''
} = {}) {
    if (!origin || !formFingerprint) {
        throw new Error('origin and formFingerprint are required to fetch form mappings.');
    }

    return fetchJson(
        buildApiUrl('/api/extension/v1/form-mappings', {
            origin: String(origin || ''),
            form_fingerprint: String(formFingerprint || '')
        })
    );
}

async function saveExtensionFormMappingsToApi({
    origin = '',
    formFingerprint = '',
    mappings = []
} = {}) {
    if (!origin || !formFingerprint) {
        throw new Error('origin and formFingerprint are required to save form mappings.');
    }

    return fetchJson(
        buildApiUrl('/api/extension/v1/form-mappings'),
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                origin: String(origin || ''),
                form_fingerprint: String(formFingerprint || ''),
                mappings: Array.isArray(mappings) ? mappings : []
            })
        }
    );
}

async function fetchExtensionSessionFromApi({ forceSession = false } = {}) {
    try {
        return await fetchJson(
            buildApiUrl('/api/extension/v1/session'),
            {},
            forceSession ? { credentialsMode: 'include', token: '' } : {}
        );
    } catch (error) {
        const statusMatch = String(error?.message || '').match(/HTTP\s+(\d+)/);
        const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : null;

        if (status === 404) {
            // Backward-compatible fallback when backend has no dedicated extension session endpoint yet.
            await fetchJson(buildApiUrl('/api/spaces'));
            const runtime = await resolveApiRuntime();
            return {
                user: {
                    id: 'legacy',
                    email: '',
                    name: 'Legacy backend'
                },
                auth: {
                    method: runtime.token ? 'bearer_token' : 'session',
                    can_issue_tokens: false,
                    token: null
                },
                meta: {
                    legacy: true
                }
            };
        }

        throw new Error(describeHttpError(error, 'Could not verify API connection'));
    }
}

async function issueExtensionTokenFromApi({ name = '', expiresInDays = null } = {}) {
    const payload = {};
    if (name && String(name).trim()) {
        payload.name = String(name).trim();
    }

    if (expiresInDays !== null && expiresInDays !== undefined && expiresInDays !== '') {
        payload.expires_in_days = Number.parseInt(String(expiresInDays), 10);
    }

    return fetchJson(
        buildApiUrl('/api/extension/v1/tokens'),
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        },
        {
            credentialsMode: 'include',
            token: ''
        }
    );
}

async function revokeExtensionTokenFromApi(tokenId) {
    return fetchJson(
        buildApiUrl(`/api/extension/v1/tokens/${tokenId}/revoke`),
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        },
        {
            credentialsMode: 'include',
            token: ''
        }
    );
}

async function listExtensionTokensFromApi(limit = 20) {
    const parsedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 20;
    const data = await fetchJson(
        buildApiUrl('/api/extension/v1/tokens/list', { limit: parsedLimit }),
        {},
        {
            credentialsMode: 'include',
            token: ''
        }
    );

    return Array.isArray(data?.items) ? data.items : [];
}

async function saveExtensionSettings(payload = {}) {
    const { apiToken, credentialsMode, tokenMeta } = payload;
    const updates = {};

    if (Object.prototype.hasOwnProperty.call(payload, 'apiToken')) {
        updates[STORAGE_KEYS.apiToken] = normalizeToken(apiToken);
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'credentialsMode')) {
        updates[STORAGE_KEYS.credentialsMode] = sanitizeCredentialsMode(credentialsMode);
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'tokenMeta')) {
        updates[STORAGE_KEYS.tokenMeta] = sanitizeTokenMeta(tokenMeta);
    }

    if (!Object.keys(updates).length) {
        return;
    }

    await storageSet(updates);
}

async function clearStoredExtensionToken() {
    await storageSet({
        [STORAGE_KEYS.apiToken]: '',
        [STORAGE_KEYS.tokenMeta]: null
    });
}

async function getExtensionSettingsSummary() {
    const runtime = await resolveApiRuntime();

    return {
        apiBaseUrl,
        apiOrigin: toApiOriginLabel(apiBaseUrl),
        tokenSource: runtime.tokenSource,
        tokenPreview: toTokenPreview(runtime.token),
        hasActiveToken: Boolean(runtime.token),
        credentialsMode: runtime.credentialsMode,
        tokenMeta: runtime.tokenMeta,
        hasStoredToken: runtime.tokenSource === 'storage',
        hasEnvToken: runtime.tokenSource === 'env'
    };
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

    let response;
    try {
        response = await sendMessageToTab(tab.id, tabMessage);
    } catch (connectionError) {
        const msg = String(connectionError?.message || '');
        if (msg.includes('Could not establish connection') || msg.includes('Receiving end does not exist')) {
            throw new Error('Could not reach the page. Please refresh it and try again.');
        }
        throw connectionError;
    }

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
    if (message.action === 'openSidePanelFromWebApp') {
        const tabId = sender?.tab?.id;
        if (!tabId) {
            sendResponse({
                success: false,
                error: 'Cannot open side panel without a tab context.',
                preloaded: false,
                preloadError: null,
                requiresUserGesture: false
            });
            return false;
        }

        if (!chrome.sidePanel?.open) {
            sendResponse({
                success: false,
                error: 'Side panel is not supported in this browser.',
                preloaded: false,
                preloadError: null,
                requiresUserGesture: false
            });
            return false;
        }

        const requestedSpaceUuid = sanitizeOrganizationUuid(message.spaceUuid)
            || extractSpaceUuidFromUrl(message.pageUrl)
            || extractSpaceUuidFromUrl(sender?.tab?.url || '');
        chrome.sidePanel.open({ tabId }, () => {
            if (chrome.runtime.lastError) {
                const openError = chrome.runtime.lastError.message || 'Could not open side panel.';
                sendResponse({
                    success: false,
                    error: openError,
                    preloaded: false,
                    preloadError: null,
                    requiresUserGesture: isUserGestureRequirementError(openError)
                });
                return;
            }

            if (!requestedSpaceUuid) {
                sendResponse({
                    success: true,
                    preloaded: false,
                    preloadError: null
                });
                return;
            }

            preloadSelectedSpace(requestedSpaceUuid)
                .then(result => {
                    sendResponse({
                        success: true,
                        preloaded: result.preloaded,
                        preloadError: result.preloadError
                    });
                })
                .catch(error => {
                    sendResponse({
                        success: true,
                        preloaded: false,
                        preloadError: error?.message || 'Could not preload selected space.'
                    });
                });
        });

        return true;
    }

    async function handleMessage() {
        if (message.action === 'fetchApplications') {
            const query = typeof message.query === 'string' ? message.query.trim() : '';
            const rawLimit = Number.parseInt(String(message.limit || ''), 10);
            const rawCursor = Number.parseInt(String(message.cursor || ''), 10);
            const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 40;
            const cursor = Number.isFinite(rawCursor) ? Math.max(rawCursor, 0) : 0;
            const organizationUuid = sanitizeOrganizationUuid(message.organizationUuid);
            const payload = await fetchApplicationsFromApi(query, limit, cursor, organizationUuid);
            return {
                success: true,
                applications: payload.applications,
                nextCursor: payload.nextCursor,
                source: payload.source
            };
        }

        if (message.action === 'fetchApplicationData' && message.applicationId) {
            const data = await fetchApplicationDetailFromApi(message.applicationId);
            return { success: true, data };
        }

        if (message.action === 'matchFormFieldsWithAi' && message.applicationId) {
            const data = await matchFormFieldsWithAiFromApi({
                applicationId: message.applicationId,
                origin: message.origin,
                url: message.url,
                formFingerprint: message.formFingerprint,
                fields: message.fields,
                memoryHints: message.memoryHints
            });

            return {
                success: true,
                items: Array.isArray(data?.items) ? data.items : [],
                meta: data?.meta || null
            };
        }

        if (message.action === 'getExtensionFormMappings') {
            const data = await fetchExtensionFormMappingsFromApi({
                origin: message.origin,
                formFingerprint: message.formFingerprint
            });

            return {
                success: true,
                origin: data?.origin || '',
                formFingerprint: data?.form_fingerprint || '',
                mappings: Array.isArray(data?.mappings) ? data.mappings : [],
                meta: data?.meta || null
            };
        }

        if (message.action === 'saveExtensionFormMappings') {
            const data = await saveExtensionFormMappingsToApi({
                origin: message.origin,
                formFingerprint: message.formFingerprint,
                mappings: message.mappings
            });

            return {
                success: true,
                savedCount: Number.parseInt(String(data?.saved_count || '0'), 10) || 0
            };
        }

        if (message.action === 'getExtensionSession') {
            const session = await fetchExtensionSessionFromApi({ forceSession: Boolean(message.forceSession) });
            return { success: true, session };
        }

        if (message.action === 'getExtensionSettings') {
            const settings = await getExtensionSettingsSummary();
            return { success: true, settings };
        }

        if (message.action === 'saveExtensionSettings') {
            const payload = {};
            if (Object.prototype.hasOwnProperty.call(message, 'apiToken')) {
                payload.apiToken = message.apiToken;
            }
            if (Object.prototype.hasOwnProperty.call(message, 'credentialsMode')) {
                payload.credentialsMode = message.credentialsMode;
            }
            if (Object.prototype.hasOwnProperty.call(message, 'tokenMeta')) {
                payload.tokenMeta = message.tokenMeta;
            }

            await saveExtensionSettings(payload);
            const settings = await getExtensionSettingsSummary();
            return { success: true, settings };
        }

        if (message.action === 'clearExtensionToken') {
            await clearStoredExtensionToken();
            const settings = await getExtensionSettingsSummary();
            return { success: true, settings };
        }

        if (message.action === 'issueExtensionToken') {
            const issued = await issueExtensionTokenFromApi({
                name: message.name,
                expiresInDays: message.expiresInDays
            });

            const tokenMeta = {
                id: issued.id,
                name: issued.name,
                keyPrefix: issued.key_prefix || toTokenPreview(issued.token),
                expiresAt: issued.expires_at || null,
                source: 'issued',
                createdAt: new Date().toISOString()
            };

            await saveExtensionSettings({
                apiToken: issued.token,
                credentialsMode: 'omit',
                tokenMeta
            });

            const settings = await getExtensionSettingsSummary();
            return {
                success: true,
                issuedToken: issued.token,
                tokenMeta,
                settings
            };
        }

        if (message.action === 'revokeExtensionToken') {
            const tokenId = String(message.tokenId || '').trim();
            if (!tokenId) {
                throw new Error('Token id is required for revoke.');
            }

            await revokeExtensionTokenFromApi(tokenId);
            const runtime = await resolveApiRuntime();
            if (runtime.tokenMeta?.id === tokenId) {
                await clearStoredExtensionToken();
            }

            const settings = await getExtensionSettingsSummary();
            return { success: true, settings };
        }

        if (message.action === 'rotateExtensionToken') {
            const runtime = await resolveApiRuntime();
            const existingTokenId = String(message.tokenId || runtime.tokenMeta?.id || '').trim();
            if (!existingTokenId) {
                throw new Error('Rotation requires a stored token issued from this extension.');
            }

            await revokeExtensionTokenFromApi(existingTokenId);
            const issued = await issueExtensionTokenFromApi({
                name: message.name || runtime.tokenMeta?.name || '',
                expiresInDays: message.expiresInDays
            });

            const tokenMeta = {
                id: issued.id,
                name: issued.name,
                keyPrefix: issued.key_prefix || toTokenPreview(issued.token),
                expiresAt: issued.expires_at || null,
                source: 'rotated',
                createdAt: new Date().toISOString()
            };

            await saveExtensionSettings({
                apiToken: issued.token,
                credentialsMode: 'omit',
                tokenMeta
            });

            const settings = await getExtensionSettingsSummary();
            return {
                success: true,
                issuedToken: issued.token,
                tokenMeta,
                settings
            };
        }

        if (message.action === 'listExtensionTokens') {
            const tokens = await listExtensionTokensFromApi(Number.parseInt(String(message.limit || '20'), 10));
            return { success: true, tokens };
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
