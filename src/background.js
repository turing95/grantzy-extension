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

function wrapChromeCallback(executor, { defaultValue, rejectOnError = false } = {}) {
    return new Promise((resolve, reject) => {
        executor((...args) => {
            const runtimeError = chrome.runtime.lastError;
            if (runtimeError) {
                if (rejectOnError) {
                    reject(new Error(runtimeError.message));
                    return;
                }
                resolve(defaultValue);
                return;
            }

            if (!args.length) {
                resolve(defaultValue);
                return;
            }

            resolve(args[0]);
        });
    });
}

function storageGet(keys) {
    return wrapChromeCallback(
        callback => chrome.storage.local.get(keys, callback),
        { defaultValue: {} }
    ).then(data => data || {});
}

function storageSet(values) {
    return wrapChromeCallback(
        callback => chrome.storage.local.set(values, callback),
        { defaultValue: null }
    ).then(() => undefined);
}

function sessionGet(keys) {
    if (!chrome.storage.session) return Promise.resolve({});
    return wrapChromeCallback(
        callback => chrome.storage.session.get(keys, callback),
        { defaultValue: {} }
    ).then(data => data || {});
}

function sessionSet(values) {
    if (!chrome.storage.session) return Promise.resolve();
    return wrapChromeCallback(
        callback => chrome.storage.session.set(values, callback),
        { defaultValue: null }
    ).then(() => undefined);
}

async function hardenStorageAccessLevels() {
    const areaNames = ['local', 'session'];
    await Promise.all(areaNames.map(async areaName => {
        const area = chrome.storage?.[areaName];
        if (!area || typeof area.setAccessLevel !== 'function') {
            return;
        }

        try {
            await wrapChromeCallback(
                callback => area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }, callback),
                { defaultValue: null, rejectOnError: true }
            );
        } catch (error) {
            console.warn(`Could not set storage.${areaName} access level:`, error);
        }
    }));
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
    const [sessionData, localData] = await Promise.all([
        sessionGet([STORAGE_KEYS.apiToken, STORAGE_KEYS.credentialsMode, STORAGE_KEYS.tokenMeta]),
        storageGet([STORAGE_KEYS.apiToken, STORAGE_KEYS.credentialsMode, STORAGE_KEYS.tokenMeta])
    ]);

    const sessionToken = normalizeToken(sessionData[STORAGE_KEYS.apiToken]);
    const localToken = normalizeToken(localData[STORAGE_KEYS.apiToken]);
    const envToken = normalizeToken(defaultApiToken);
    const activeToken = sessionToken || localToken || envToken;
    const activeTokenSource = sessionToken ? 'session' : (localToken ? 'storage' : (envToken ? 'env' : 'none'));

    const mergedMeta = sessionData[STORAGE_KEYS.tokenMeta] || localData[STORAGE_KEYS.tokenMeta];
    const mergedCredentials = sessionData[STORAGE_KEYS.credentialsMode]
        || localData[STORAGE_KEYS.credentialsMode]
        || defaultCredentialsMode;

    return {
        token: activeToken,
        tokenSource: activeTokenSource,
        credentialsMode: sanitizeCredentialsMode(mergedCredentials),
        tokenMeta: sanitizeTokenMeta(mergedMeta)
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
    } catch (error) {
        const statusMatch = String(error?.message || '').match(/HTTP\s+(\d+)/);
        const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : null;
        if (status === 401 || status === 403 || status >= 500) {
            throw error;
        }

        // Fallback for older backend deployments (404 / method mismatch).
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

async function fetchPortalInsertionPlanFromApi({ applicationId, fillableId } = {}) {
    if (!applicationId) {
        throw new Error('applicationId is required for portal insertion plan.');
    }
    if (!fillableId) {
        throw new Error('fillableId is required for portal insertion plan.');
    }

    return fetchJson(
        buildApiUrl(`/api/extension/v1/spaces/${applicationId}/portal-insertion-plan/${fillableId}`)
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

    await Promise.all([
        storageSet(updates),
        sessionSet(updates)
    ]);
}

async function clearStoredExtensionToken() {
    const clearPayload = {
        [STORAGE_KEYS.apiToken]: '',
        [STORAGE_KEYS.tokenMeta]: null
    };
    await Promise.all([
        storageSet(clearPayload),
        sessionSet(clearPayload)
    ]);
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
    return wrapChromeCallback(
        callback => chrome.tabs.query(queryInfo, callback),
        { rejectOnError: true, defaultValue: [] }
    ).then(tabs => tabs || []);
}

function permissionsContains(permissions) {
    return wrapChromeCallback(
        callback => chrome.permissions.contains(permissions, callback),
        { rejectOnError: true, defaultValue: false }
    ).then(result => Boolean(result));
}

function permissionsRequest(permissions) {
    return wrapChromeCallback(
        callback => chrome.permissions.request(permissions, callback),
        { rejectOnError: true, defaultValue: false }
    ).then(granted => Boolean(granted));
}

function executeScript(tabId, files) {
    return wrapChromeCallback(
        callback => chrome.scripting.executeScript(
            {
                target: { tabId },
                files
            },
            callback
        ),
        { rejectOnError: true, defaultValue: null }
    ).then(() => undefined);
}

function sendMessageToTab(tabId, payload) {
    return wrapChromeCallback(
        callback => chrome.tabs.sendMessage(tabId, payload, callback),
        { rejectOnError: true, defaultValue: null }
    );
}

function isScriptableUrl(url) {
    if (!url) {
        return false;
    }

    return url.startsWith('http://') || url.startsWith('https://');
}

function getOriginPattern(url) {
    try {
        const parsedUrl = new URL(url);
        return `${parsedUrl.origin}/*`;
    } catch (_error) {
        throw new Error('Invalid URL: cannot determine origin pattern.');
    }
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

function parseBoundedInteger(rawValue, fallback, min, max) {
    const parsed = Number.parseInt(String(rawValue || ''), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(Math.max(parsed, min), max);
}

function toIssuedTokenMeta(issued, source) {
    return {
        id: issued.id,
        name: issued.name,
        keyPrefix: issued.key_prefix || toTokenPreview(issued.token),
        expiresAt: issued.expires_at || null,
        source,
        createdAt: new Date().toISOString()
    };
}

async function handleFetchApplications(message) {
    const query = typeof message.query === 'string' ? message.query.trim() : '';
    const limit = parseBoundedInteger(message.limit, 40, 1, 100);
    const cursor = parseBoundedInteger(message.cursor, 0, 0, Number.MAX_SAFE_INTEGER);
    const organizationUuid = sanitizeOrganizationUuid(message.organizationUuid);
    const payload = await fetchApplicationsFromApi(query, limit, cursor, organizationUuid);
    return {
        success: true,
        applications: payload.applications,
        nextCursor: payload.nextCursor,
        source: payload.source
    };
}

async function handleFetchApplicationData(message) {
    if (!message.applicationId) {
        throw new Error('applicationId is required');
    }
    const data = await fetchApplicationDetailFromApi(message.applicationId);
    return { success: true, data };
}

async function handleFetchPortalInsertionPlan(message) {
    if (!message.applicationId) {
        throw new Error('applicationId is required');
    }
    if (!message.fillableId) {
        throw new Error('fillableId is required');
    }

    const data = await fetchPortalInsertionPlanFromApi({
        applicationId: message.applicationId,
        fillableId: message.fillableId
    });

    return {
        success: true,
        plan: {
            spaceUuid: String(data?.space_uuid || ''),
            fillableUuid: String(data?.fillable_uuid || ''),
            variantUuid: String(data?.variant_uuid || ''),
            portalUrl: String(data?.portal_url || ''),
            schemaVersion: Number(data?.schema_version || 0),
            summaryNote: String(data?.summary_note || ''),
            fields: Array.isArray(data?.fields) ? data.fields : [],
            warnings: Array.isArray(data?.warnings) ? data.warnings : []
        }
    };
}

async function handleSaveExtensionSettings(message) {
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

async function handleIssueExtensionToken(message) {
    const issued = await issueExtensionTokenFromApi({
        name: message.name,
        expiresInDays: message.expiresInDays
    });

    const tokenMeta = toIssuedTokenMeta(issued, 'issued');
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

async function handleRevokeExtensionToken(message) {
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

async function handleRotateExtensionToken(message) {
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

    const tokenMeta = toIssuedTokenMeta(issued, 'rotated');
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

async function handleGetActiveTabInfo() {
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


// ------------------------------ Platform scan ------------------------------

function captureVisibleTabPng(windowId) {
    return new Promise((resolve, reject) => {
        try {
            chrome.tabs.captureVisibleTab(
                windowId ?? null,
                { format: 'png' },
                dataUrl => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (!dataUrl) {
                        reject(new Error('captureVisibleTab returned no data'));
                        return;
                    }
                    // Strip the "data:image/png;base64," prefix.
                    const idx = dataUrl.indexOf(',');
                    resolve(idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl);
                }
            );
        } catch (err) {
            reject(err);
        }
    });
}

function debuggerSend(target, method, params = {}) {
    return new Promise((resolve, reject) => {
        chrome.debugger.sendCommand(target, method, params, result => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(result);
        });
    });
}

function debuggerAttach(target, version = '1.3') {
    return new Promise((resolve, reject) => {
        chrome.debugger.attach(target, version, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve();
        });
    });
}

function debuggerDetach(target) {
    return new Promise(resolve => {
        try {
            chrome.debugger.detach(target, () => {
                // Ignore lastError — we just want best-effort detach.
                void chrome.runtime.lastError;
                resolve();
            });
        } catch (_e) {
            resolve();
        }
    });
}

// Hard cap on full-page screenshot height to keep the OpenAI/Anthropic image
// payload reasonable. Beyond this we crop. Both providers happily accept ~10MB
// PNGs but token cost on tall images grows linearly.
const FULL_PAGE_MAX_HEIGHT = 8000;
const FULL_PAGE_MAX_WIDTH = 1800;

async function captureFullPagePng(tabId) {
    const target = { tabId };
    await debuggerAttach(target, '1.3');
    try {
        const metrics = await debuggerSend(target, 'Page.getLayoutMetrics');
        const content = metrics?.cssContentSize || metrics?.contentSize || {};
        const widthRaw = Math.ceil(Number(content.width) || 0);
        const heightRaw = Math.ceil(Number(content.height) || 0);
        if (widthRaw <= 0 || heightRaw <= 0) {
            throw new Error('Invalid layout metrics');
        }
        const width = Math.min(widthRaw, FULL_PAGE_MAX_WIDTH);
        const height = Math.min(heightRaw, FULL_PAGE_MAX_HEIGHT);
        const result = await debuggerSend(target, 'Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: true,
            clip: { x: 0, y: 0, width, height, scale: 1 },
        });
        const data = result?.data;
        if (!data) throw new Error('Page.captureScreenshot returned no data');
        return data;
    } finally {
        await debuggerDetach(target);
    }
}

async function captureTabScreenshotPng(tab) {
    // Prefer full-page via the debugger protocol so long forms are captured
    // in one shot. Fall back to the viewport-only capture if the user denies
    // the debugger banner or the protocol fails (e.g. another debugger already
    // attached).
    try {
        return await captureFullPagePng(tab.id);
    } catch (err) {
        try {
            // best-effort: ensure we don't leak a debugger session
            await debuggerDetach({ tabId: tab.id });
        } catch (_e) {}
        const msg = String(err?.message || '');
        // Some failure modes are user-actionable; surface them clearly upstream.
        // Most others fall through to viewport capture.
        const fallbackReasons = [
            'Another debugger is already attached',
            'Cannot access',
            'Cannot attach',
            'Debugger is already attached',
            'No tab with given id',
        ];
        if (fallbackReasons.some(r => msg.includes(r))) {
            // Use the visible-tab fallback so the operator still gets something
            // even if the debugger banner is rejected.
        }
        return await captureVisibleTabPng(tab.windowId);
    }
}

async function handlePlatformScanRunInfo(message) {
    const scanRunUuid = String(message.scanRunUuid || '').trim();
    if (!scanRunUuid) {
        throw new Error('scanRunUuid is required');
    }
    const data = await fetchJson(
        buildApiUrl(`/api/setup/platform-scan/${scanRunUuid}/info/`)
    );
    return { success: true, info: data };
}

async function handlePlatformScanCapture(message) {
    const scanRunUuid = String(message.scanRunUuid || '').trim();
    if (!scanRunUuid) {
        throw new Error('scanRunUuid is required');
    }
    const captureContext = String(message.captureContext || '').trim();

    // 1. Discover form fields via the existing content script. The side panel
    //    is responsible for requesting permission (chrome.permissions.request
    //    requires a direct user gesture which is lost when bouncing through
    //    the background message channel).
    const tab = await getActiveTab();
    await ensureTabPermission(tab.url || '', false);
    await executeScript(tab.id, ['src/formFiller.content.js']);
    let scanResponse;
    const openDropdowns = message.openDropdowns !== false;  // default ON
    try {
        scanResponse = await sendMessageToTab(tab.id, {
            action: '__grantzy_scan_form',
            openDropdowns,
        });
    } catch (connectionError) {
        const msg = String(connectionError?.message || '');
        if (msg.includes('Could not establish connection') || msg.includes('Receiving end does not exist')) {
            throw new Error('Could not reach the page. Please refresh it and try again.');
        }
        throw connectionError;
    }
    if (!scanResponse || scanResponse.success === false) {
        throw new Error(scanResponse?.error || 'Form discovery failed');
    }
    const domFields = Array.isArray(scanResponse.fields) ? scanResponse.fields : [];
    const ariaSnapshot = typeof scanResponse.ariaSnapshot === 'string' ? scanResponse.ariaSnapshot : '';

    // 2. Capture full-page screenshot (with viewport fallback).
    const screenshotB64 = await captureTabScreenshotPng(tab);

    // 3. POST to backend.
    const data = await fetchJson(
        buildApiUrl(`/api/setup/platform-scan/${scanRunUuid}/capture/`),
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                current_url: tab.url || scanResponse.url || '',
                page_title: tab.title || '',
                screenshot_b64: screenshotB64,
                dom_fields: domFields,
                aria_snapshot: ariaSnapshot,
                capture_context: captureContext,
            }),
        }
    );

    return { success: true, capture: data };
}

async function handlePlatformScanRestart(message) {
    const scanRunUuid = String(message.scanRunUuid || '').trim();
    if (!scanRunUuid) {
        throw new Error('scanRunUuid is required');
    }
    const data = await fetchJson(
        buildApiUrl(`/api/setup/platform-scan/${scanRunUuid}/restart/`),
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    );
    return { success: true, restart: data };
}

async function handlePlatformScanCommit(message) {
    const scanRunUuid = String(message.scanRunUuid || '').trim();
    if (!scanRunUuid) {
        throw new Error('scanRunUuid is required');
    }
    const status = String(message.status || 'completed').trim();
    const data = await fetchJson(
        buildApiUrl(`/api/setup/platform-scan/${scanRunUuid}/commit/`),
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        }
    );
    return { success: true, commit: data };
}

async function handlePlatformScanDeleteCapture(message) {
    const scanRunUuid = String(message.scanRunUuid || '').trim();
    const captureIndex = Number(message.captureIndex);
    if (!scanRunUuid) throw new Error('scanRunUuid is required');
    if (!Number.isInteger(captureIndex) || captureIndex < 1) {
        throw new Error('captureIndex must be a positive integer (1-based)');
    }
    const data = await fetchJson(
        buildApiUrl(`/api/setup/platform-scan/${scanRunUuid}/captures/${captureIndex}/delete/`),
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    return { success: true, delete: data };
}

async function handlePlatformScanReprocess(message) {
    const scanRunUuid = String(message.scanRunUuid || '').trim();
    if (!scanRunUuid) throw new Error('scanRunUuid is required');
    const dryRun = message.dryRun !== false;
    const data = await fetchJson(
        buildApiUrl(`/api/setup/platform-scan/${scanRunUuid}/reprocess/`),
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dry_run: dryRun }),
        },
    );
    return { success: true, reprocess: data };
}

async function handlePlatformScanList(message) {
    const url = buildApiUrl('/api/setup/platform-scan/list/', {
        status: message.status || '',
        search: message.search || '',
        limit: message.limit || '',
    });
    const data = await fetchJson(url);
    return { success: true, list: data };
}

async function handlePlatformScanFillables(message) {
    const url = buildApiUrl('/api/setup/platform-scan/fillables/', {
        search: message.search || '',
        limit: message.limit || '',
    });
    const data = await fetchJson(url);
    return { success: true, fillables: data };
}

async function handlePlatformScanCreate(message) {
    const fillableUuid = String(message.fillableUuid || '').trim();
    if (!fillableUuid) throw new Error('fillableUuid is required');
    const data = await fetchJson(
        buildApiUrl('/api/setup/platform-scan/create/'),
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fillable_uuid: fillableUuid }),
        },
    );
    return { success: true, run: data };
}

async function handlePlatformScanFullState(message) {
    /* Returns the run + full captures meta + accumulated tree, for the
       sidepanel "captures list" + "live tree view" UI. */
    const scanRunUuid = String(message.scanRunUuid || '').trim();
    if (!scanRunUuid) throw new Error('scanRunUuid is required');
    const data = await fetchJson(
        buildApiUrl(`/api/setup/platform-scan/${scanRunUuid}/state/`),
        { method: 'GET' },
    );
    return { success: true, state: data };
}

const ACTION_HANDLERS = {
    fetchApplications: handleFetchApplications,
    fetchApplicationData: handleFetchApplicationData,
    fetchPortalInsertionPlan: handleFetchPortalInsertionPlan,
    getExtensionSession: async message => {
        const session = await fetchExtensionSessionFromApi({ forceSession: Boolean(message.forceSession) });
        return { success: true, session };
    },
    getExtensionSettings: async () => {
        const settings = await getExtensionSettingsSummary();
        return { success: true, settings };
    },
    saveExtensionSettings: handleSaveExtensionSettings,
    clearExtensionToken: async () => {
        await clearStoredExtensionToken();
        const settings = await getExtensionSettingsSummary();
        return { success: true, settings };
    },
    issueExtensionToken: handleIssueExtensionToken,
    revokeExtensionToken: handleRevokeExtensionToken,
    rotateExtensionToken: handleRotateExtensionToken,
    listExtensionTokens: async message => {
        const tokens = await listExtensionTokensFromApi(parseBoundedInteger(message.limit, 20, 1, 100));
        return { success: true, tokens };
    },
    scanFormInActiveTab: async () => runTabAutofillAction({ action: '__grantzy_scan_form' }),
    applyFillPlanInActiveTab: async message => runTabAutofillAction({
        action: '__grantzy_apply_fill',
        planItems: Array.isArray(message.planItems) ? message.planItems : []
    }),
    undoLastFillInActiveTab: async () => runTabAutofillAction({ action: '__grantzy_undo_fill' }),
    platformScanRunInfo: handlePlatformScanRunInfo,
    platformScanCapture: handlePlatformScanCapture,
    platformScanCommit: handlePlatformScanCommit,
    platformScanRestart: handlePlatformScanRestart,
    platformScanDeleteCapture: handlePlatformScanDeleteCapture,
    platformScanReprocess: handlePlatformScanReprocess,
    platformScanFullState: handlePlatformScanFullState,
    platformScanList: handlePlatformScanList,
    platformScanFillables: handlePlatformScanFillables,
    platformScanCreate: handlePlatformScanCreate,
    getActiveTabInfo: handleGetActiveTabInfo,
    downloadFile: async (message) => {
        if (!message.fileUuid) {
            throw new Error('fileUuid is required');
        }
        const data = await fetchJson(
            buildApiUrl(`/api/extension/v1/files/${message.fileUuid}/download/`)
        );
        if (!data.download_url) {
            throw new Error('No download URL received');
        }
        const downloadId = await new Promise((resolve, reject) => {
            chrome.downloads.download({
                url: data.download_url,
                filename: data.filename || message.fileName || 'download'
            }, id => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(id);
                }
            });
        });
        return { success: true, downloadId };
    }
};

function handleOpenSidePanelFromWebApp(message, sender, sendResponse) {
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

        chrome.storage.local.set({ grantzyPreloadingSpace: requestedSpaceUuid });

        preloadSelectedSpace(requestedSpaceUuid)
            .then(result => {
                chrome.storage.local.remove('grantzyPreloadingSpace');
                sendResponse({
                    success: true,
                    preloaded: result.preloaded,
                    preloadError: result.preloadError
                });
            })
            .catch(error => {
                chrome.storage.local.remove('grantzyPreloadingSpace');
                sendResponse({
                    success: true,
                    preloaded: false,
                    preloadError: error?.message || 'Could not preload selected space.'
                });
            });
    });

    return true;
}

async function dispatchBackgroundAction(rawMessage) {
    const message = rawMessage && typeof rawMessage === 'object' ? rawMessage : {};
    const action = String(message.action || '').trim();
    const handler = ACTION_HANDLERS[action];
    if (!handler) {
        return { success: false, error: 'Unknown action' };
    }
    return handler(message);
}

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
    const message = rawMessage && typeof rawMessage === 'object' ? rawMessage : {};
    if (message.action === 'openSidePanelFromWebApp') {
        return handleOpenSidePanelFromWebApp(message, sender, sendResponse);
    }

    dispatchBackgroundAction(message)
        .then(result => sendResponse(result))
        .catch(error => {
            console.error('Background action error:', error);
            sendResponse({ success: false, error: error.message || 'Unknown error' });
        });

    return true;
});

hardenStorageAccessLevels().catch(error => {
    console.warn('Storage access level hardening failed:', error);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
        chrome.runtime.sendMessage({
            action: '__activeTabUrlChanged',
            tabId,
            url: changeInfo.url
        }).catch(() => {
            // Side panel may not be open — ignore.
        });
    }
});
