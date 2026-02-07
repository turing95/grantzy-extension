import {
    setupApplicationSearch,
    setupDataSearch,
    flattenFields,
    updateDataResults,
    resultsSelection
} from './searchHandler.js';
import {
    buildFillPlan,
    isDropdownField,
    resolveOptionMatch
} from './fillPlanner.js';
import {
    loadMappingMemory,
    saveMappingMemory,
    listRecentMappingMemories
} from './mappingMemory.js';

const searchInput = document.getElementById('app-search-input');
const resultsContainer = document.getElementById('app-search-results');
const widgetEl = document.getElementById('grantzy-sidepanel');
const containerEl = widgetEl.querySelector('.widget-container');
const mainPanelEl = document.getElementById('main-panel');
const headerEl = widgetEl.querySelector('.widget-header');
const backButton = document.getElementById('back-button');
const connectionStatusEl = document.getElementById('connection-status');
const recheckConnectionBtn = document.getElementById('recheck-connection-btn');
const applicationsViewButton = document.getElementById('show-applications-view-btn');
const quickAccessViewButton = document.getElementById('show-quick-access-view-btn');
const settingsViewButton = document.getElementById('show-settings-view-btn');
const applicationsViewEl = document.getElementById('applications-view');
const quickAccessViewEl = document.getElementById('quick-access-view');
const settingsViewEl = document.getElementById('settings-view');
const recentApplicationsListEl = document.getElementById('recent-applications-list');
const recentMappingsListEl = document.getElementById('recent-mappings-list');
const settingsStatusEl = document.getElementById('settings-status');
const settingsCredentialsModeSelect = document.getElementById('settings-credentials-mode');
const settingsTokenInput = document.getElementById('settings-token-input');
const saveSettingsButton = document.getElementById('save-settings-btn');
const clearTokenButton = document.getElementById('clear-token-btn');
const validateSettingsButton = document.getElementById('validate-settings-btn');
const issueTokenButton = document.getElementById('issue-token-btn');
const rotateTokenButton = document.getElementById('rotate-token-btn');
const revokeTokenButton = document.getElementById('revoke-token-btn');
const settingsTokenNameInput = document.getElementById('settings-token-name-input');
const settingsTokenExpirySelect = document.getElementById('settings-token-expiry-select');
const settingsTokenMetaEl = document.getElementById('settings-token-meta');
const settingsTokenListEl = document.getElementById('settings-token-list');

const analyzeFormButton = document.getElementById('analyze-form-btn');
const previewFillButton = document.getElementById('preview-fill-btn');
const applyFillButton = document.getElementById('apply-fill-btn');
const undoFillButton = document.getElementById('undo-fill-btn');
const autofillStatusEl = document.getElementById('autofill-status');
const autofillPreviewEl = document.getElementById('autofill-preview');
const autofillReportEl = document.getElementById('autofill-report');

widgetEl.searchContextData = null;
widgetEl.activeOrganizationUuid = '';

let sidebarEl = null;
let selectedTreeNodeElement = null;
let selectedTreeNodeData = null;
let selectedApplication = null;

let flatGrantzyFields = [];
let latestScan = null;
let currentFillPlan = [];
let isBusy = false;
let currentView = 'applications';
let extensionSettings = null;
let canManageTokensWithSession = false;
let activeApiOriginLabel = '';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RECENT_APPLICATIONS_KEY = 'grantzyRecentApplicationsV1';
const MAX_RECENT_APPLICATIONS = 8;

function sendRuntimeMessage(payload) {
    return new Promise(resolve => {
        chrome.runtime.sendMessage(payload, response => {
            if (chrome.runtime.lastError) {
                resolve({ success: false, error: chrome.runtime.lastError.message });
                return;
            }

            resolve(response || { success: false, error: 'No response from background' });
        });
    });
}

function storageGet(keys) {
    return new Promise(resolve => {
        chrome.storage.local.get(keys, data => resolve(data));
    });
}

function storageSet(payload) {
    return new Promise(resolve => {
        chrome.storage.local.set(payload, () => resolve());
    });
}

function formatRelativeTime(timestamp) {
    if (!timestamp) {
        return 'just now';
    }

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return 'just now';
    }

    const delta = date.getTime() - Date.now();
    const absoluteDelta = Math.abs(delta);
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

    if (absoluteDelta < 60_000) {
        return 'just now';
    }
    if (absoluteDelta < 3_600_000) {
        return formatter.format(Math.round(delta / 60_000), 'minute');
    }
    if (absoluteDelta < 86_400_000) {
        return formatter.format(Math.round(delta / 3_600_000), 'hour');
    }
    if (absoluteDelta < 2_592_000_000) {
        return formatter.format(Math.round(delta / 86_400_000), 'day');
    }
    return formatter.format(Math.round(delta / 2_592_000_000), 'month');
}

function normalizeOriginLabel(origin) {
    try {
        const parsed = new URL(origin);
        return parsed.host || origin;
    } catch (_error) {
        return origin || 'unknown origin';
    }
}

function toApiOriginLabel(rawUrl) {
    if (!rawUrl) {
        return '';
    }

    try {
        return new URL(rawUrl).origin;
    } catch (_error) {
        return String(rawUrl);
    }
}

function sanitizeOrganizationUuid(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return UUID_PATTERN.test(normalized) ? normalized : '';
}

function extractOrganizationUuidFromUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl || '');
        if (activeApiOriginLabel && parsed.origin !== activeApiOriginLabel) {
            return '';
        }

        const segments = parsed.pathname.split('/').filter(Boolean);
        const orgIndex = segments.indexOf('organizations');
        if (orgIndex < 0 || orgIndex + 1 >= segments.length) {
            return '';
        }
        return sanitizeOrganizationUuid(segments[orgIndex + 1]);
    } catch (_error) {
        return '';
    }
}

async function refreshActiveOrganizationScope() {
    const tabInfo = await sendRuntimeMessage({ action: 'getActiveTabInfo' });
    if (!tabInfo.success) {
        widgetEl.activeOrganizationUuid = '';
        return '';
    }

    const scopedOrganizationUuid = extractOrganizationUuidFromUrl(tabInfo.url || '');
    widgetEl.activeOrganizationUuid = scopedOrganizationUuid;
    return scopedOrganizationUuid;
}

async function setupApplicationsViewSearch() {
    await refreshActiveOrganizationScope();
    setupApplicationSearch(searchInput, resultsContainer, widgetEl);
}

function getApiTargetLabel() {
    return activeApiOriginLabel || 'the configured API host';
}

function setSettingsStatus(message, tone = 'neutral') {
    if (!settingsStatusEl) {
        return;
    }

    settingsStatusEl.textContent = message;
    settingsStatusEl.classList.remove('error', 'success');
    if (tone === 'error') {
        settingsStatusEl.classList.add('error');
    } else if (tone === 'success') {
        settingsStatusEl.classList.add('success');
    }
}

function getSelectedTokenExpiryDays() {
    const raw = Number.parseInt(String(settingsTokenExpirySelect?.value || ''), 10);
    if (!Number.isFinite(raw) || raw < 1) {
        return 90;
    }
    return Math.min(raw, 365);
}

function showToast(message, duration = 2200) {
    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.textContent = message;
    document.body.appendChild(toast);

    window.setTimeout(() => {
        toast.classList.add('hiding');
        window.setTimeout(() => toast.remove(), 250);
    }, duration);
}

function setConnectionStatus(message, tone = 'neutral') {
    if (!connectionStatusEl) {
        return;
    }

    connectionStatusEl.textContent = message;
    connectionStatusEl.classList.remove('ok', 'error', 'pending');
    if (tone === 'ok') {
        connectionStatusEl.classList.add('ok');
    } else if (tone === 'error') {
        connectionStatusEl.classList.add('error');
    } else if (tone === 'pending') {
        connectionStatusEl.classList.add('pending');
    }
}

function summarizeAuthMode(method) {
    if (method === 'bearer_token') {
        return 'token auth';
    }
    return 'session auth';
}

async function refreshConnectionStatus({ withSpinner = true } = {}) {
    if (withSpinner) {
        setConnectionStatus(`Checking connection to ${getApiTargetLabel()}...`, 'pending');
    }

    const response = await sendRuntimeMessage({ action: 'getExtensionSession' });
    if (!response.success) {
        setConnectionStatus(response.error || `Not connected to ${getApiTargetLabel()}.`, 'error');
        return null;
    }

    const session = response.session || {};
    const displayName = session.user?.name || session.user?.email || 'unknown user';
    const authMode = summarizeAuthMode(session.auth?.method);
    setConnectionStatus(`Connected to ${getApiTargetLabel()} as ${displayName} (${authMode})`, 'ok');
    return session;
}

function requestOriginPermission(originPattern) {
    return new Promise(resolve => {
        chrome.permissions.request({ origins: [originPattern] }, granted => {
            if (chrome.runtime.lastError) {
                resolve({ granted: false, error: chrome.runtime.lastError.message });
                return;
            }

            resolve({ granted: Boolean(granted) });
        });
    });
}

async function ensureActiveTabPermission() {
    const tabInfo = await sendRuntimeMessage({ action: 'getActiveTabInfo' });
    if (!tabInfo.success) {
        setAutofillStatus(tabInfo.error || 'Could not access active tab info.', 'error');
        return false;
    }

    if (!tabInfo.scriptable) {
        setAutofillStatus('Open a regular website tab (http/https) before autofill.', 'error');
        return false;
    }

    if (tabInfo.hasPermission) {
        return true;
    }

    const permissionResult = await requestOriginPermission(tabInfo.originPattern);
    if (!permissionResult.granted) {
        setAutofillStatus(permissionResult.error || 'Permission denied for this site.', 'error');
        return false;
    }

    return true;
}

function setAutofillStatus(message, tone = 'info') {
    autofillStatusEl.textContent = message;
    autofillStatusEl.classList.remove('error', 'success');
    if (tone === 'error') {
        autofillStatusEl.classList.add('error');
    }
    if (tone === 'success') {
        autofillStatusEl.classList.add('success');
    }
}

function setBusyState(nextBusy) {
    isBusy = nextBusy;
    updateActionButtons();
}

function updateActionButtons() {
    const hasApplication = Boolean(selectedApplication);
    const hasScan = Boolean(latestScan?.fields?.length);
    const hasPlan = currentFillPlan.length > 0;
    const hasSelectedPlanItems = currentFillPlan.some(item => item.enabled && item.grantzyKey);

    analyzeFormButton.disabled = isBusy || !hasApplication;
    previewFillButton.disabled = isBusy || !hasApplication || !flatGrantzyFields.length;
    applyFillButton.disabled = isBusy || !hasPlan || !hasSelectedPlanItems;
    undoFillButton.disabled = isBusy || !hasScan;
}

function getApplicationSummary(rawApplication) {
    if (!rawApplication) {
        return null;
    }

    const uuid = String(rawApplication.uuid || '').trim();
    if (!uuid) {
        return null;
    }

    return {
        uuid,
        title: String(rawApplication.title || '').trim() || 'Untitled application',
        companyName: String(rawApplication.companyName || rawApplication.company_name || '').trim(),
        updatedAt: rawApplication.updatedAt || rawApplication.updated_at || null,
        openedAt: Date.now()
    };
}

function applyViewVisibility() {
    const isApplicationsView = currentView === 'applications';
    applicationsViewEl?.classList.toggle('active', isApplicationsView);
    quickAccessViewEl?.classList.toggle('active', currentView === 'quick_access');
    settingsViewEl?.classList.toggle('active', currentView === 'settings');

    applicationsViewButton?.classList.toggle('active', isApplicationsView);
    quickAccessViewButton?.classList.toggle('active', currentView === 'quick_access');
    settingsViewButton?.classList.toggle('active', currentView === 'settings');

    if (searchInput) {
        searchInput.classList.toggle('hidden', !isApplicationsView);
    }

    const shouldShowSidebar = Boolean(sidebarEl) && isApplicationsView;
    containerEl.classList.toggle('no-sidebar', !shouldShowSidebar);

    if (sidebarEl) {
        sidebarEl.style.display = shouldShowSidebar ? '' : 'none';
    }
}

async function setActiveView(nextView) {
    currentView = nextView;
    applyViewVisibility();

    if (nextView === 'quick_access') {
        await renderQuickAccessPanel();
    } else if (nextView === 'settings') {
        await refreshSettingsPanel();
    }
}

async function getRecentApplications() {
    const data = await storageGet(RECENT_APPLICATIONS_KEY);
    const value = data[RECENT_APPLICATIONS_KEY];
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter(item => item && item.uuid)
        .slice(0, MAX_RECENT_APPLICATIONS);
}

async function recordRecentApplication(rawApplication) {
    const summary = getApplicationSummary(rawApplication);
    if (!summary) {
        return;
    }

    const current = await getRecentApplications();
    const deduped = current.filter(item => item.uuid !== summary.uuid);
    const next = [summary, ...deduped].slice(0, MAX_RECENT_APPLICATIONS);
    await storageSet({ [RECENT_APPLICATIONS_KEY]: next });
}

function clearResultSelectionState() {
    resultsContainer.innerHTML = '';
    searchInput.disabled = false;
    searchInput.value = '';
}

async function selectApplication(rawApplication, { focusSearch = true } = {}) {
    const summary = getApplicationSummary(rawApplication);
    if (!summary) {
        setAutofillStatus('Invalid application selection.', 'error');
        return;
    }

    await storageSet({
        selectedApplication: {
            uuid: summary.uuid,
            title: summary.title,
            companyName: summary.companyName,
            updatedAt: summary.updatedAt
        }
    });

    clearResultSelectionState();
    const loader = document.createElement('div');
    loader.className = 'loader';
    loader.textContent = 'Loading application data...';
    searchInput.disabled = true;
    resultsContainer.appendChild(loader);

    await new Promise(resolve => {
        setupDataSearch(searchInput, resultsContainer, summary.uuid, widgetEl, () => resolve());
    });

    headerEl.textContent = `Application selected: ${summary.title} | ${summary.companyName}`;
    backButton.style.display = 'block';
    searchInput.disabled = false;
    searchInput.value = '';
    if (focusSearch) {
        searchInput.focus();
    }

    await refreshFlatGrantzyFields();
    await recordRecentApplication(summary);
}

function renderQuickEmptyState(container, message) {
    container.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'state-card state-neutral';
    empty.textContent = message;
    container.appendChild(empty);
}

async function renderRecentApplicationsList() {
    if (!recentApplicationsListEl) {
        return;
    }

    const items = await getRecentApplications();
    if (!items.length) {
        renderQuickEmptyState(recentApplicationsListEl, 'No recent applications yet.');
        return;
    }

    recentApplicationsListEl.innerHTML = '';
    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'quick-item';

        const meta = document.createElement('div');
        meta.className = 'quick-item-meta';

        const title = document.createElement('strong');
        title.textContent = item.title;
        meta.appendChild(title);

        const detail = document.createElement('span');
        const company = item.companyName || 'No company';
        detail.textContent = `${company} • opened ${formatRelativeTime(item.openedAt)}`;
        meta.appendChild(detail);

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Open';
        button.addEventListener('click', async () => {
            await setActiveView('applications');
            await selectApplication(item);
        });

        row.appendChild(meta);
        row.appendChild(button);
        recentApplicationsListEl.appendChild(row);
    });
}

async function handleRecentMappingClick(mappingItem) {
    await setActiveView('applications');

    if (!selectedApplication && mappingItem.application?.uuid) {
        await selectApplication({
            uuid: mappingItem.application.uuid,
            title: mappingItem.application.title,
            companyName: mappingItem.application.companyName
        }, { focusSearch: false });
    }

    if (!selectedApplication && !mappingItem.application?.uuid) {
        setAutofillStatus('Select an application before applying saved mapping memory.', 'error');
        return;
    }

    await previewFillPlan();
}

async function renderRecentMappingsList() {
    if (!recentMappingsListEl) {
        return;
    }

    const recentMappings = await listRecentMappingMemories(8);
    if (!recentMappings.length) {
        renderQuickEmptyState(recentMappingsListEl, 'No mapping memory captured yet.');
        return;
    }

    recentMappingsListEl.innerHTML = '';
    recentMappings.forEach(item => {
        const row = document.createElement('div');
        row.className = 'quick-item';

        const meta = document.createElement('div');
        meta.className = 'quick-item-meta';

        const title = document.createElement('strong');
        const appLabel = item.application?.title || normalizeOriginLabel(item.origin);
        title.textContent = appLabel;
        meta.appendChild(title);

        const detail = document.createElement('span');
        detail.textContent = `${item.mappingCount} mappings • ${normalizeOriginLabel(item.origin)} • ${formatRelativeTime(item.updatedAt)}`;
        meta.appendChild(detail);

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Use';
        button.addEventListener('click', async () => {
            await handleRecentMappingClick(item);
        });

        row.appendChild(meta);
        row.appendChild(button);
        recentMappingsListEl.appendChild(row);
    });
}

async function renderQuickAccessPanel() {
    await Promise.all([
        renderRecentApplicationsList(),
        renderRecentMappingsList()
    ]);
}

function renderTokenMeta() {
    if (!settingsTokenMetaEl) {
        return;
    }

    const tokenMeta = extensionSettings?.tokenMeta;
    if (tokenMeta?.id) {
        const name = tokenMeta.name || 'Managed token';
        const prefix = tokenMeta.keyPrefix || 'n/a';
        const expires = tokenMeta.expiresAt
            ? new Date(tokenMeta.expiresAt).toLocaleString()
            : 'No expiry';
        settingsTokenMetaEl.textContent = `${name} (${prefix}) • expires: ${expires}`;
        return;
    }

    if (extensionSettings?.hasActiveToken) {
        settingsTokenMetaEl.textContent = `Active token source: ${extensionSettings.tokenSource}. Preview: ${extensionSettings.tokenPreview || 'hidden'}`;
        return;
    }

    settingsTokenMetaEl.textContent = 'No managed token yet.';
}

function renderTokenList(tokens = []) {
    if (!settingsTokenListEl) {
        return;
    }

    settingsTokenListEl.innerHTML = '';
    if (!tokens.length) {
        const empty = document.createElement('div');
        empty.className = 'state-card state-neutral';
        empty.textContent = 'No extension tokens visible for your current web session.';
        settingsTokenListEl.appendChild(empty);
        return;
    }

    tokens.forEach(token => {
        const row = document.createElement('div');
        row.className = 'settings-token-item';

        const meta = document.createElement('div');
        meta.className = 'settings-token-meta';

        const title = document.createElement('strong');
        const status = token.is_active && !token.is_expired ? 'active' : 'inactive';
        title.textContent = `${token.name || 'Unnamed token'} (${status})`;
        meta.appendChild(title);

        const detail = document.createElement('span');
        const created = token.created_at ? formatRelativeTime(token.created_at) : 'unknown';
        detail.textContent = `${token.key_prefix || ''} • created ${created}`;
        meta.appendChild(detail);

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Revoke';
        button.disabled = !token.is_active || token.is_expired;
        button.addEventListener('click', async () => {
            const revoke = await sendRuntimeMessage({
                action: 'revokeExtensionToken',
                tokenId: token.id
            });
            if (!revoke.success) {
                setSettingsStatus(revoke.error || 'Could not revoke token.', 'error');
                return;
            }

            extensionSettings = revoke.settings || extensionSettings;
            renderTokenMeta();
            setSettingsStatus('Token revoked successfully.', 'success');
            await refreshSettingsPanel();
            await refreshConnectionStatus({ withSpinner: false });
        });

        row.appendChild(meta);
        row.appendChild(button);
        settingsTokenListEl.appendChild(row);
    });
}

async function refreshSettingsList() {
    const listResponse = await sendRuntimeMessage({ action: 'listExtensionTokens', limit: 20 });
    if (!listResponse.success) {
        renderTokenList([]);
        return;
    }

    renderTokenList(Array.isArray(listResponse.tokens) ? listResponse.tokens : []);
}

async function refreshSettingsPanel() {
    setSettingsStatus('Loading settings...', 'neutral');
    const settingsResponse = await sendRuntimeMessage({ action: 'getExtensionSettings' });
    if (!settingsResponse.success) {
        setSettingsStatus(settingsResponse.error || 'Could not load extension settings.', 'error');
        return;
    }

    extensionSettings = settingsResponse.settings;
    activeApiOriginLabel = toApiOriginLabel(extensionSettings.apiBaseUrl || extensionSettings.apiOrigin);
    if (settingsCredentialsModeSelect) {
        settingsCredentialsModeSelect.value = extensionSettings.credentialsMode || 'omit';
    }

    if (settingsTokenInput) {
        settingsTokenInput.value = '';
        settingsTokenInput.placeholder = extensionSettings.tokenPreview
            ? `Current: ${extensionSettings.tokenPreview}`
            : 'grx_...';
    }

    if (settingsTokenNameInput && !settingsTokenNameInput.value) {
        settingsTokenNameInput.value = extensionSettings.tokenMeta?.name || 'Grantzy Chrome Extension';
    }

    const sessionCheck = await sendRuntimeMessage({
        action: 'getExtensionSession',
        forceSession: true
    });
    canManageTokensWithSession = Boolean(sessionCheck.success);

    issueTokenButton.disabled = !canManageTokensWithSession;
    rotateTokenButton.disabled = !canManageTokensWithSession || !extensionSettings?.tokenMeta?.id;
    revokeTokenButton.disabled = !canManageTokensWithSession || !extensionSettings?.tokenMeta?.id;

    renderTokenMeta();
    await refreshSettingsList();
    setSettingsStatus(
        canManageTokensWithSession
            ? 'Settings loaded. Session management available.'
            : `Settings loaded. Session management unavailable until you log in on ${getApiTargetLabel()}.`,
        canManageTokensWithSession ? 'success' : 'neutral'
    );
}

function statusBadge(status) {
    const badge = document.createElement('span');
    badge.className = `preview-badge ${status}`;
    badge.textContent = status.replace('_', ' ');
    return badge;
}

function getGrantzyValueByKey(key) {
    const match = flatGrantzyFields.find(item => item.key === key);
    return match ? String(match.value ?? '') : '';
}

function getSelectableOptions(item) {
    const candidateKeys = item.candidates.map(candidate => candidate.key);
    const directKeys = flatGrantzyFields.map(field => field.key);
    const unique = new Set([...candidateKeys, ...directKeys]);

    return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

function applyManualMapping(item, selectedKey) {
    if (!selectedKey) {
        item.grantzyKey = null;
        item.grantzyValue = '';
        item.status = 'skipped';
        item.reason = 'unmapped';
        item.confidence = 0;
        item.dropdownOption = null;
        item.enabled = false;
        return;
    }

    item.grantzyKey = selectedKey;
    item.grantzyValue = getGrantzyValueByKey(selectedKey);

    if (isDropdownField(item.field)) {
        const optionMatch = resolveOptionMatch(item.field, item.grantzyValue);
        item.dropdownOption = optionMatch.option;
        item.confidence = Math.max(0.7, optionMatch.confidence || 0.7);
        item.status = optionMatch.confidence >= 0.9 ? 'manual' : 'needs_review';
        item.reason = optionMatch.reason;
    } else {
        item.dropdownOption = null;
        item.confidence = 1;
        item.status = 'manual';
        item.reason = 'manually_mapped';
    }

    item.enabled = true;
}

function renderFillPlan() {
    autofillPreviewEl.innerHTML = '';

    if (!currentFillPlan.length) {
        const empty = document.createElement('div');
        empty.textContent = 'No fill plan yet. Click Preview Fill after analyzing a form.';
        autofillPreviewEl.appendChild(empty);
        updateActionButtons();
        return;
    }

    currentFillPlan.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'preview-row';

        const includeCheckbox = document.createElement('input');
        includeCheckbox.type = 'checkbox';
        includeCheckbox.checked = Boolean(item.enabled);
        includeCheckbox.disabled = !item.grantzyKey;
        includeCheckbox.addEventListener('change', () => {
            item.enabled = includeCheckbox.checked;
            updateActionButtons();
        });

        const main = document.createElement('div');
        main.className = 'preview-main';

        const header = document.createElement('div');
        header.className = 'preview-header';

        const label = document.createElement('strong');
        label.textContent = item.fieldLabel || `Field ${index + 1}`;
        header.appendChild(label);
        header.appendChild(statusBadge(item.status));

        const meta = document.createElement('div');
        meta.textContent = `Confidence ${(item.confidence * 100).toFixed(0)}% | ${item.field.widgetKind}`;

        const controls = document.createElement('div');
        controls.className = 'preview-controls';

        const select = document.createElement('select');
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = 'Skip field';
        select.appendChild(emptyOption);

        getSelectableOptions(item).forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key;
            if (item.grantzyKey === key) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        select.addEventListener('change', () => {
            applyManualMapping(item, select.value);
            renderFillPlan();
        });

        controls.appendChild(select);

        const valuePreview = document.createElement('small');
        valuePreview.textContent = `Value: ${item.grantzyValue || '(none)'}`;

        main.appendChild(header);
        main.appendChild(meta);
        main.appendChild(controls);
        main.appendChild(valuePreview);

        if (isDropdownField(item.field)) {
            const dropdownNote = document.createElement('small');
            dropdownNote.textContent = item.dropdownOption
                ? `Option: ${item.dropdownOption.text || item.dropdownOption.value}`
                : 'Option: not matched';
            main.appendChild(dropdownNote);
        }

        const reason = document.createElement('small');
        reason.textContent = `Reason: ${item.reason || 'n/a'}`;
        main.appendChild(reason);

        row.appendChild(includeCheckbox);
        row.appendChild(main);
        autofillPreviewEl.appendChild(row);
    });

    updateActionButtons();
}

function renderFillReport(results = []) {
    autofillReportEl.innerHTML = '';

    if (!results.length) {
        autofillReportEl.textContent = 'No fill report yet.';
        return;
    }

    const summary = {
        filled: 0,
        skipped: 0
    };

    results.forEach(result => {
        if (result.status === 'filled') {
            summary.filled += 1;
        } else {
            summary.skipped += 1;
        }

        const line = document.createElement('div');
        line.textContent = `${result.fieldId}: ${result.status} (${result.reason || 'n/a'})`;
        autofillReportEl.appendChild(line);
    });

    const heading = document.createElement('div');
    heading.style.marginBottom = '6px';
    heading.style.fontWeight = 'bold';
    heading.textContent = `Filled ${summary.filled}, Skipped ${summary.skipped}`;
    autofillReportEl.prepend(heading);
}

function resetAutofillState() {
    latestScan = null;
    currentFillPlan = [];
    autofillReportEl.textContent = '';
    autofillPreviewEl.textContent = 'No fill plan yet. Click Preview Fill after analyzing a form.';
    updateActionButtons();
}

async function refreshFlatGrantzyFields() {
    const data = await storageGet('selectedApplicationData');
    if (data.selectedApplicationData?.fields) {
        if (Array.isArray(data.selectedApplicationData.flatFields)) {
            flatGrantzyFields = data.selectedApplicationData.flatFields;
        } else {
            flatGrantzyFields = flattenFields(data.selectedApplicationData.fields);
        }
    } else {
        flatGrantzyFields = [];
    }

    updateActionButtons();
    applyViewVisibility();
}

async function analyzeCurrentForm() {
    if (!selectedApplication) {
        setAutofillStatus('Select an application first.', 'error');
        return;
    }

    const hasPermission = await ensureActiveTabPermission();
    if (!hasPermission) {
        return;
    }

    setBusyState(true);
    setAutofillStatus('Analyzing fields on current tab...');

    const response = await sendRuntimeMessage({ action: 'scanFormInActiveTab' });
    setBusyState(false);

    if (!response.success) {
        setAutofillStatus(response.error || 'Could not analyze form.', 'error');
        return;
    }

    latestScan = {
        origin: response.origin,
        formFingerprint: response.formFingerprint,
        url: response.url,
        fields: Array.isArray(response.fields) ? response.fields : []
    };

    if (!latestScan.fields.length) {
        setAutofillStatus('No fillable fields detected on this page.', 'error');
    } else {
        setAutofillStatus(`Detected ${latestScan.fields.length} fields. Click Preview Fill to inspect mapping.`, 'success');
    }

    renderFillReport([]);
    currentFillPlan = [];
    renderFillPlan();
}

async function previewFillPlan() {
    if (!flatGrantzyFields.length) {
        await refreshFlatGrantzyFields();
    }

    if (!flatGrantzyFields.length) {
        setAutofillStatus('No application data loaded yet. Select an application first.', 'error');
        return;
    }

    if (!latestScan?.fields?.length) {
        await analyzeCurrentForm();
        if (!latestScan?.fields?.length) {
            return;
        }
    }

    setBusyState(true);
    setAutofillStatus('Building autofill preview...');

    const memory = await loadMappingMemory(latestScan.origin, latestScan.formFingerprint);

    currentFillPlan = buildFillPlan({
        formFields: latestScan.fields,
        grantzyFields: flatGrantzyFields,
        memory
    }).map(item => ({
        ...item,
        enabled: item.status === 'auto' || item.status === 'manual'
    }));

    setBusyState(false);
    renderFillPlan();

    const autoCount = currentFillPlan.filter(item => item.status === 'auto').length;
    const reviewCount = currentFillPlan.filter(item => item.status === 'needs_review').length;
    const skippedCount = currentFillPlan.filter(item => item.status === 'skipped').length;

    setAutofillStatus(
        `Preview ready: ${autoCount} auto, ${reviewCount} review, ${skippedCount} skipped.`,
        'success'
    );
}

async function applyFillPlanToTab() {
    const selectedItems = currentFillPlan.filter(item => item.enabled && item.grantzyKey);

    if (!selectedItems.length) {
        setAutofillStatus('Select at least one mapped field to apply fill.', 'error');
        return;
    }

    const hasPermission = await ensureActiveTabPermission();
    if (!hasPermission) {
        return;
    }

    setBusyState(true);
    setAutofillStatus(`Applying ${selectedItems.length} fields...`);

    const response = await sendRuntimeMessage({
        action: 'applyFillPlanInActiveTab',
        planItems: selectedItems
    });

    setBusyState(false);

    if (!response.success) {
        setAutofillStatus(response.error || 'Failed to apply fill plan.', 'error');
        return;
    }

    const results = Array.isArray(response.results) ? response.results : [];
    renderFillReport(results);

    const filledIds = new Set(results.filter(result => result.status === 'filled').map(result => result.fieldId));
    const memoryItems = selectedItems
        .filter(item => filledIds.has(item.fieldId))
        .map(item => ({
            fieldSignature: item.fieldSignature,
            grantzyKey: item.grantzyKey,
            dropdownOption: item.dropdownOption
        }));

    if (memoryItems.length && latestScan?.origin && latestScan?.formFingerprint) {
        await saveMappingMemory(
            latestScan.origin,
            latestScan.formFingerprint,
            memoryItems,
            {
                application: selectedApplication
                    ? {
                        uuid: selectedApplication.uuid,
                        title: selectedApplication.title,
                        companyName: selectedApplication.companyName
                    }
                    : null,
                formUrl: latestScan.url || null
            }
        );
        await renderRecentMappingsList();
    }

    const filledCount = results.filter(result => result.status === 'filled').length;
    const skippedCount = results.length - filledCount;
    setAutofillStatus(`Autofill complete. Filled ${filledCount}, skipped ${skippedCount}.`, 'success');
}

async function undoLastFill() {
    const hasPermission = await ensureActiveTabPermission();
    if (!hasPermission) {
        return;
    }

    setBusyState(true);
    setAutofillStatus('Undoing last autofill on current tab...');

    const response = await sendRuntimeMessage({ action: 'undoLastFillInActiveTab' });
    setBusyState(false);

    if (!response.success) {
        setAutofillStatus(response.error || 'Undo failed.', 'error');
        return;
    }

    setAutofillStatus(`Undo completed. Restored ${response.undone || 0} fields.`, 'success');
}

function renderTree(data) {
    const ul = document.createElement('ul');
    const entries = Array.isArray(data)
        ? data
        : (data && typeof data === 'object')
            ? Object.keys(data).map(key => ({ key, value: data[key] }))
            : [];

    entries.forEach(item => {
        const rawChildData = item.value;
        const hasChildren = Boolean(
            rawChildData
            && typeof rawChildData === 'object'
            && (Array.isArray(rawChildData) ? rawChildData.length : Object.keys(rawChildData).length)
        );

        const li = document.createElement('li');
        li.dataset.expanded = hasChildren ? 'false' : 'leaf';

        const labelButton = document.createElement('button');
        labelButton.type = 'button';
        labelButton.className = 'tree-label';

        const caret = document.createElement('span');
        caret.className = hasChildren ? 'tree-caret' : 'tree-caret leaf';
        caret.textContent = hasChildren ? '▸' : '•';
        labelButton.appendChild(caret);

        const text = document.createElement('span');
        text.className = 'tree-label-text';
        text.textContent = item.key;
        text.title = item.key;
        labelButton.appendChild(text);

        li.appendChild(labelButton);

        labelButton.addEventListener('click', event => {
            event.stopPropagation();

            if (!hasChildren) {
                const leafNodeData = [{ key: item.key, value: item.value }];
                setSelectedTreeNode(leafNodeData, li);
                return;
            }

            Array.from(li.parentElement.children).forEach(sibling => {
                if (sibling !== li && sibling.dataset.expanded === 'true') {
                    const childUl = Array.from(sibling.children).find(
                        child => child.tagName && child.tagName.toLowerCase() === 'ul'
                    );
                    if (childUl) sibling.removeChild(childUl);
                    sibling.dataset.expanded = 'false';
                    sibling.classList.remove('selected');
                }
            });

            if (li.dataset.expanded === 'false') {
                if (rawChildData && typeof rawChildData === 'object') {
                    let childData = rawChildData;
                    if (!Array.isArray(rawChildData)) {
                        childData = Object.keys(rawChildData).map(key => ({ key, value: rawChildData[key] }));
                    }
                    const childUl = renderTree(childData);
                    li.appendChild(childUl);
                }
                li.dataset.expanded = 'true';
                setSelectedTreeNode(item.value, li);
            } else {
                const childUl = Array.from(li.children).find(
                    child => child.tagName && child.tagName.toLowerCase() === 'ul'
                );
                if (childUl) li.removeChild(childUl);
                li.dataset.expanded = 'false';
                if (selectedTreeNodeElement && li.contains(selectedTreeNodeElement)) {
                    clearSelectedTreeNode();
                }
            }
        });

        ul.appendChild(li);
    });

    return ul;
}

function setSelectedTreeNode(data, liElement) {
    selectedTreeNodeData = data;
    if (selectedTreeNodeElement && selectedTreeNodeElement !== liElement) {
        selectedTreeNodeElement.classList.remove('selected');
    }

    liElement.classList.add('selected');
    selectedTreeNodeElement = liElement;
    widgetEl.searchContextData = data;
    triggerSearchForSelectedNode();
    highlightSelectedRootNode();
}

function highlightSelectedRootNode() {
    if (!selectedTreeNodeElement) {
        return;
    }

    let current = selectedTreeNodeElement;
    while (current.parentElement && !current.parentElement.classList.contains('widget-sidebar')) {
        if (current.parentElement.tagName.toLowerCase() === 'li') {
            current = current.parentElement;
        } else {
            break;
        }
    }

    if (sidebarEl) {
        sidebarEl.querySelectorAll('li').forEach(node => node.classList.remove('selected-root'));
    }

    current.classList.add('selected-root');
}

function clearSelectedTreeNode() {
    if (selectedTreeNodeElement) {
        selectedTreeNodeElement.classList.remove('selected');
        selectedTreeNodeElement = null;
    }

    selectedTreeNodeData = null;
    widgetEl.searchContextData = null;
}

function triggerSearchForSelectedNode() {
    if (!selectedTreeNodeData) {
        return;
    }

    const flattened = flattenFields(selectedTreeNodeData);
    updateDataResults(resultsContainer, flattened);
    resultsSelection(resultsContainer, searchInput);
}

function updateSidebar(nextSelectedApplication) {
    selectedApplication = nextSelectedApplication || null;

    if (selectedApplication) {
        containerEl.classList.remove('no-sidebar');

        if (!sidebarEl) {
            sidebarEl = document.createElement('div');
            sidebarEl.classList.add('widget-sidebar');
            containerEl.insertBefore(sidebarEl, mainPanelEl);
        }

        sidebarEl.innerHTML = '';
        chrome.storage.local.get('selectedApplicationData', data => {
            if (data.selectedApplicationData?.fields) {
                const tree = renderTree(data.selectedApplicationData.fields);
                if (tree.querySelector('li')) {
                    sidebarEl.appendChild(tree);
                } else {
                    const noTreeData = document.createElement('p');
                    noTreeData.textContent = 'No groups found in this application.';
                    sidebarEl.appendChild(noTreeData);
                }
            } else {
                const noData = document.createElement('p');
                noData.textContent = 'No data available.';
                sidebarEl.appendChild(noData);
            }
        });

        headerEl.textContent = `Application: ${selectedApplication.title}`;
        backButton.style.display = 'block';
    } else {
        if (sidebarEl) {
            sidebarEl.remove();
            sidebarEl = null;
        }

        clearSelectedTreeNode();
        containerEl.classList.add('no-sidebar');
        headerEl.textContent = 'Grantzy Applications';
        backButton.style.display = 'none';
    }

    updateActionButtons();
    applyViewVisibility();
}

async function saveSettingsFromForm() {
    const credentialsMode = settingsCredentialsModeSelect?.value || 'omit';
    const enteredToken = String(settingsTokenInput?.value || '').trim();
    const payload = {
        action: 'saveExtensionSettings',
        credentialsMode
    };

    if (enteredToken) {
        payload.apiToken = enteredToken;
        payload.tokenMeta = null;
    }

    const response = await sendRuntimeMessage(payload);
    if (!response.success) {
        setSettingsStatus(response.error || 'Could not save settings.', 'error');
        return;
    }

    extensionSettings = response.settings || extensionSettings;
    if (settingsTokenInput) {
        settingsTokenInput.value = '';
    }

    await refreshConnectionStatus({ withSpinner: true });
    await refreshSettingsPanel();
    setSettingsStatus('Settings saved.', 'success');
}

async function clearStoredTokenFromSettings() {
    const response = await sendRuntimeMessage({ action: 'clearExtensionToken' });
    if (!response.success) {
        setSettingsStatus(response.error || 'Could not clear token.', 'error');
        return;
    }

    extensionSettings = response.settings || extensionSettings;
    if (settingsTokenInput) {
        settingsTokenInput.value = '';
    }

    await refreshConnectionStatus({ withSpinner: true });
    await refreshSettingsPanel();
    setSettingsStatus('Stored token cleared.', 'success');
}

async function validateSettingsConnection() {
    const session = await refreshConnectionStatus({ withSpinner: true });
    if (!session) {
        setSettingsStatus('Connection check failed. Verify token/session settings.', 'error');
        return;
    }

    setSettingsStatus('Connection is healthy.', 'success');
}

async function issueManagedToken() {
    if (!canManageTokensWithSession) {
        setSettingsStatus(`Session login required on ${getApiTargetLabel()} to issue a token.`, 'error');
        return;
    }

    setSettingsStatus('Issuing token from backend...', 'neutral');
    const response = await sendRuntimeMessage({
        action: 'issueExtensionToken',
        name: settingsTokenNameInput?.value || 'Grantzy Chrome Extension',
        expiresInDays: getSelectedTokenExpiryDays()
    });

    if (!response.success) {
        setSettingsStatus(response.error || 'Could not issue token.', 'error');
        return;
    }

    extensionSettings = response.settings || extensionSettings;
    if (settingsTokenInput) {
        settingsTokenInput.value = '';
    }

    showToast('New extension token issued');
    await refreshConnectionStatus({ withSpinner: true });
    await refreshSettingsPanel();
    setSettingsStatus('New token issued and applied to extension settings.', 'success');
}

async function rotateManagedToken() {
    if (!canManageTokensWithSession) {
        setSettingsStatus(`Session login required on ${getApiTargetLabel()} to rotate a token.`, 'error');
        return;
    }

    if (!extensionSettings?.tokenMeta?.id) {
        setSettingsStatus('Rotation requires a managed token issued from this extension.', 'error');
        return;
    }

    setSettingsStatus('Rotating token...', 'neutral');
    const response = await sendRuntimeMessage({
        action: 'rotateExtensionToken',
        tokenId: extensionSettings.tokenMeta.id,
        name: settingsTokenNameInput?.value || extensionSettings.tokenMeta.name || 'Grantzy Chrome Extension',
        expiresInDays: getSelectedTokenExpiryDays()
    });

    if (!response.success) {
        setSettingsStatus(response.error || 'Could not rotate token.', 'error');
        return;
    }

    extensionSettings = response.settings || extensionSettings;
    showToast('Token rotated');
    await refreshConnectionStatus({ withSpinner: true });
    await refreshSettingsPanel();
    setSettingsStatus('Token rotated successfully.', 'success');
}

async function revokeManagedToken() {
    if (!canManageTokensWithSession) {
        setSettingsStatus(`Session login required on ${getApiTargetLabel()} to revoke tokens.`, 'error');
        return;
    }

    if (!extensionSettings?.tokenMeta?.id) {
        setSettingsStatus('No managed token is currently stored.', 'error');
        return;
    }

    setSettingsStatus('Revoking token...', 'neutral');
    const response = await sendRuntimeMessage({
        action: 'revokeExtensionToken',
        tokenId: extensionSettings.tokenMeta.id
    });

    if (!response.success) {
        setSettingsStatus(response.error || 'Could not revoke token.', 'error');
        return;
    }

    extensionSettings = response.settings || extensionSettings;
    showToast('Token revoked');
    await refreshConnectionStatus({ withSpinner: true });
    await refreshSettingsPanel();
    setSettingsStatus('Token revoked and removed from extension settings.', 'success');
}

analyzeFormButton.addEventListener('click', analyzeCurrentForm);
previewFillButton.addEventListener('click', previewFillPlan);
applyFillButton.addEventListener('click', applyFillPlanToTab);
undoFillButton.addEventListener('click', undoLastFill);

applicationsViewButton?.addEventListener('click', () => {
    setActiveView('applications');
});
quickAccessViewButton?.addEventListener('click', () => {
    setActiveView('quick_access');
});
settingsViewButton?.addEventListener('click', () => {
    setActiveView('settings');
});

saveSettingsButton?.addEventListener('click', () => {
    saveSettingsFromForm();
});
clearTokenButton?.addEventListener('click', () => {
    clearStoredTokenFromSettings();
});
validateSettingsButton?.addEventListener('click', () => {
    validateSettingsConnection();
});
issueTokenButton?.addEventListener('click', () => {
    issueManagedToken();
});
rotateTokenButton?.addEventListener('click', () => {
    rotateManagedToken();
});
revokeTokenButton?.addEventListener('click', () => {
    revokeManagedToken();
});

if (recheckConnectionBtn) {
    recheckConnectionBtn.addEventListener('click', async () => {
        const session = await refreshConnectionStatus({ withSpinner: true });
        if (currentView === 'settings') {
            setSettingsStatus(
                session ? 'Connection refreshed successfully.' : 'Connection refresh failed.',
                session ? 'success' : 'error'
            );
        }
    });
}

backButton.addEventListener('click', () => {
    chrome.storage.local.remove(['selectedApplication', 'selectedApplicationData'], async () => {
        updateSidebar(null);
        await refreshFlatGrantzyFields();
        resetAutofillState();
        setAutofillStatus('Select an application and click Analyze Current Form.');

        resultsContainer.innerHTML = '';
        searchInput.disabled = false;
        searchInput.value = '';
        await setupApplicationsViewSearch();
        await renderQuickAccessPanel();
        await setActiveView('applications');
    });
});

chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace !== 'local') {
        return;
    }

    if (changes.selectedApplication) {
        const nextApplication = changes.selectedApplication.newValue || null;
        updateSidebar(nextApplication);
        if (nextApplication) {
            await recordRecentApplication(nextApplication);
            await renderRecentApplicationsList();
        }
    }

    if (changes.selectedApplicationData) {
        await refreshFlatGrantzyFields();
        chrome.storage.local.get('selectedApplication', data => {
            updateSidebar(data.selectedApplication);
        });
    }

    if (changes[RECENT_APPLICATIONS_KEY] && currentView === 'quick_access') {
        await renderRecentApplicationsList();
    }
});

chrome.storage.local.get('selectedApplication', async data => {
    updateSidebar(data.selectedApplication);
    await refreshFlatGrantzyFields();
    resetAutofillState();
    setAutofillStatus('Select an application and click Analyze Current Form.');
    await refreshSettingsPanel();
    await setupApplicationsViewSearch();
    await setActiveView('applications');
    await refreshConnectionStatus({ withSpinner: false });
    await renderQuickAccessPanel();
    applyViewVisibility();
});
