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
import { t } from './i18n.js';
import {
    sendRuntimeMessage,
    storageGet,
    storageSet,
    storageRemove,
    toApiOriginLabel,
    formatRelativeTime
} from './utils.js';

const searchInput = document.getElementById('app-search-input');
const resultsContainer = document.getElementById('app-search-results');
const widgetEl = document.getElementById('grantzy-sidepanel');
const containerEl = widgetEl.querySelector('.widget-container');
const mainPanelEl = document.getElementById('main-panel');
const headerEl = widgetEl.querySelector('.widget-header');
const headerContextEl = document.getElementById('widget-context');
const applicationsCardTitleEl = document.getElementById('applications-card-title');
const applicationsCardSubtitleEl = document.getElementById('applications-card-subtitle');
const clearDataScopeButton = document.getElementById('clear-data-scope-btn');
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
const settingsConnectionInfoEl = document.getElementById('settings-connection-info');
const settingsConnectedDetailsEl = document.getElementById('settings-connected-details');
const settingsUserDisplayEl = document.getElementById('settings-user-display');
const settingsNotConnectedPromptEl = document.getElementById('settings-not-connected-prompt');
const settingsManageBtn = document.getElementById('settings-manage-btn');
const settingsDisconnectBtn = document.getElementById('settings-disconnect-btn');

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
let activeApiOriginLabel = '';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RECENT_APPLICATIONS_KEY = 'grantzyRecentApplicationsV1';
const MAX_RECENT_APPLICATIONS = 8;
const DEFAULT_HEADER_TITLE = t('grantzy_applications');
const DEFAULT_HEADER_CONTEXT = t('select_application_then_analyze_and_fill_current_form');
const DEFAULT_APPLICATIONS_CARD_TITLE = t('application_list');
const DEFAULT_APPLICATIONS_CARD_SUBTITLE = t('choose_application_to_load_fields');
const SELECTED_APPLICATIONS_CARD_TITLE = t('application_fields');
const SELECTED_APPLICATIONS_CARD_SUBTITLE = t('search_all_fields_and_click_value_to_copy');
const AUTOFILL_STATUS_EMPTY_APPLICATION = t('select_application_to_enable_analyze_fill_all');
const AUTOFILL_STATUS_READY = t('application_loaded_analyze_then_fill_or_preview');

function normalizeOriginLabel(origin) {
    try {
        const parsed = new URL(origin);
        return parsed.host || origin;
    } catch (_error) {
        return origin || t('unknown_origin');
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
    return activeApiOriginLabel || t('configured_api_host');
}

function setSettingsStatus(message, tone = 'neutral') {
    if (!settingsConnectionInfoEl) {
        return;
    }

    settingsConnectionInfoEl.textContent = message;
    settingsConnectionInfoEl.classList.remove('error', 'success');
    if (tone === 'error') {
        settingsConnectionInfoEl.classList.add('error');
    } else if (tone === 'success') {
        settingsConnectionInfoEl.classList.add('success');
    }
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
        return t('token_auth');
    }
    return t('session_auth');
}

async function refreshConnectionStatus({ withSpinner = true } = {}) {
    if (withSpinner) {
        setConnectionStatus(t('checking_connection_to_target', { target: getApiTargetLabel() }), 'pending');
    }

    const response = await sendRuntimeMessage({ action: 'getExtensionSession' });
    if (!response.success) {
        setConnectionStatus(response.error || t('not_connected_to_target', { target: getApiTargetLabel() }), 'error');
        return null;
    }

    const session = response.session || {};
    const displayName = session.user?.name || session.user?.email || t('unknown_user');
    const authMode = summarizeAuthMode(session.auth?.method);
    setConnectionStatus(
        t('connected_to_target_as_user_auth', {
            target: getApiTargetLabel(),
            user: displayName,
            authMode
        }),
        'ok'
    );
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
        setAutofillStatus(tabInfo.error || t('could_not_access_active_tab_info'), 'error');
        return false;
    }

    if (!tabInfo.scriptable) {
        setAutofillStatus(t('open_regular_website_tab_before_autofill'), 'error');
        return false;
    }

    if (tabInfo.hasPermission) {
        return true;
    }

    const permissionResult = await requestOriginPermission(tabInfo.originPattern);
    if (!permissionResult.granted) {
        setAutofillStatus(permissionResult.error || t('permission_denied_for_site'), 'error');
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
    const canFillAll = hasApplication && flatGrantzyFields.length && (!hasPlan || hasSelectedPlanItems);

    analyzeFormButton.disabled = isBusy || !hasApplication;
    previewFillButton.disabled = isBusy || !hasApplication || !flatGrantzyFields.length;
    applyFillButton.disabled = isBusy || !canFillAll;
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
        title: String(rawApplication.title || '').trim() || t('untitled_application'),
        companyName: String(rawApplication.companyName || rawApplication.company_name || '').trim(),
        updatedAt: rawApplication.updatedAt || rawApplication.updated_at || null,
        openedAt: Date.now()
    };
}

function getSelectedApplicationContext(nextApplication) {
    if (!nextApplication) {
        return DEFAULT_HEADER_CONTEXT;
    }

    const title = String(nextApplication.title || '').trim() || t('untitled_application');
    const company = String(nextApplication.companyName || nextApplication.company_name || '').trim();
    return company
        ? t('selected_application_title_company', { title, company })
        : t('selected_application_title', { title });
}

function updateWidgetHeader(nextApplication = null) {
    if (headerEl) {
        headerEl.textContent = DEFAULT_HEADER_TITLE;
    }
    if (headerContextEl) {
        headerContextEl.textContent = getSelectedApplicationContext(nextApplication);
    }
}

function updateApplicationsCardHeader(nextApplication = null) {
    if (applicationsCardTitleEl) {
        applicationsCardTitleEl.textContent = nextApplication
            ? SELECTED_APPLICATIONS_CARD_TITLE
            : DEFAULT_APPLICATIONS_CARD_TITLE;
    }

    if (applicationsCardSubtitleEl) {
        if (!nextApplication) {
            applicationsCardSubtitleEl.textContent = DEFAULT_APPLICATIONS_CARD_SUBTITLE;
        } else if (!flatGrantzyFields.length) {
            applicationsCardSubtitleEl.textContent = t('loading_application_fields');
        } else if (selectedTreeNodeData) {
            const scopedFields = flattenFields(selectedTreeNodeData);
            const scopeName = selectedTreeNodeElement?.querySelector('.tree-label-text')?.textContent?.trim() || t('selected_section');
            const scopedCount = scopedFields.length;
            const scopeSuffix = scopeName ? ` da "${scopeName}"` : '';
            const fieldLabel = scopedCount === 1 ? t('field_singular') : t('field_plural');
            applicationsCardSubtitleEl.textContent = scopedCount
                ? t('showing_fields_count_from_scope_click_show_all', {
                    count: scopedCount,
                    fieldLabel,
                    scopeSuffix
                })
                : t('showing_scoped_fields_from_scope_click_show_all', {
                    scopeSuffix
                });
        } else {
            const fieldLabel = flatGrantzyFields.length === 1 ? t('field_singular') : t('field_plural');
            const loadedVerb = flatGrantzyFields.length === 1 ? t('loaded_singular') : t('loaded_plural');
            applicationsCardSubtitleEl.textContent = t('fields_loaded_and_subtitle', {
                count: flatGrantzyFields.length,
                fieldLabel,
                loadedVerb,
                subtitle: SELECTED_APPLICATIONS_CARD_SUBTITLE
            });
        }
    }

    if (clearDataScopeButton) {
        clearDataScopeButton.hidden = !(nextApplication && selectedTreeNodeData);
    }
}

function setAutofillIdleStatus() {
    if (!selectedApplication) {
        setAutofillStatus(AUTOFILL_STATUS_EMPTY_APPLICATION);
        return;
    }

    if (!flatGrantzyFields.length) {
        setAutofillStatus(t('loading_application_fields'));
        return;
    }

    setAutofillStatus(AUTOFILL_STATUS_READY);
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
        setAutofillStatus(t('invalid_application_selection'), 'error');
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
    loader.textContent = t('loading_application_data');
    searchInput.disabled = true;
    resultsContainer.appendChild(loader);

    await new Promise(resolve => {
        setupDataSearch(searchInput, resultsContainer, summary.uuid, widgetEl, () => resolve());
    });

    updateWidgetHeader(summary);
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
        renderQuickEmptyState(recentApplicationsListEl, t('no_recent_applications'));
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
        const company = item.companyName || t('no_company');
        detail.textContent = t('opened_relative', { company, relative: formatRelativeTime(item.openedAt) });
        meta.appendChild(detail);

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = t('open');
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

    if (!selectedApplication) {
        if (!mappingItem.application?.uuid) {
            setAutofillStatus(t('select_application_before_apply_mapping_memory'), 'error');
            return;
        }
        await selectApplication({
            uuid: mappingItem.application.uuid,
            title: mappingItem.application.title,
            companyName: mappingItem.application.companyName
        }, { focusSearch: false });
    }

    await previewFillPlan();
}

async function renderRecentMappingsList() {
    if (!recentMappingsListEl) {
        return;
    }

    const recentMappings = await listRecentMappingMemories(8);
    if (!recentMappings.length) {
        renderQuickEmptyState(recentMappingsListEl, t('no_mapping_memory'));
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
        detail.textContent = t('mappings_count_origin_time', {
            count: item.mappingCount,
            origin: normalizeOriginLabel(item.origin),
            relative: formatRelativeTime(item.updatedAt)
        });
        meta.appendChild(detail);

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = t('use');
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

async function refreshSettingsPanel() {
    setSettingsStatus(t('checking_connection'), 'neutral');

    if (settingsConnectedDetailsEl) {
        settingsConnectedDetailsEl.style.display = 'none';
    }
    if (settingsNotConnectedPromptEl) {
        settingsNotConnectedPromptEl.style.display = 'none';
    }

    const settingsResponse = await sendRuntimeMessage({ action: 'getExtensionSettings' });
    if (settingsResponse.success) {
        extensionSettings = settingsResponse.settings;
        activeApiOriginLabel = toApiOriginLabel(extensionSettings.apiBaseUrl || extensionSettings.apiOrigin);
    }

    const session = await sendRuntimeMessage({ action: 'getExtensionSession' });
    if (session.success && session.session?.user) {
        const user = session.session.user;
        const displayName = user.name || user.email || t('unknown_user');
        setSettingsStatus(t('connected_to_target', { target: getApiTargetLabel() }), 'success');

        if (settingsUserDisplayEl) {
            settingsUserDisplayEl.textContent = displayName;
        }
        if (settingsConnectedDetailsEl) {
            settingsConnectedDetailsEl.style.display = '';
        }
        if (settingsDisconnectBtn) {
            settingsDisconnectBtn.disabled = false;
        }
    } else {
        setSettingsStatus(t('not_connected'), 'error');
        if (settingsNotConnectedPromptEl) {
            settingsNotConnectedPromptEl.style.display = '';
        }
        if (settingsDisconnectBtn) {
            settingsDisconnectBtn.disabled = true;
        }
    }
}

function statusBadge(status) {
    const badge = document.createElement('span');
    badge.className = `preview-badge ${status}`;
    const statusKey = `status_${status}`;
    const translatedStatus = t(statusKey);
    badge.textContent = translatedStatus === statusKey ? status.replace('_', ' ') : translatedStatus;
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

function normalizeConfidence(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return 0;
    }
    return Math.max(0, Math.min(1, parsed));
}

function normalizeAiStatus(rawStatus, confidence, grantzyKey) {
    if (!grantzyKey) {
        return 'skipped';
    }

    if (rawStatus === 'auto' || rawStatus === 'needs_review' || rawStatus === 'skipped') {
        return rawStatus;
    }

    if (confidence >= 0.9) {
        return 'auto';
    }
    if (confidence >= 0.6) {
        return 'needs_review';
    }
    return 'skipped';
}

function getFieldLabel(field, index) {
    return field?.label || field?.name || field?.idAttr || field?.pathHint || t('field_label_with_index', { index: index + 1 });
}

function buildMemoryHints(memory = {}) {
    return Object.entries(memory)
        .map(([fieldSignature, payload]) => ({
            field_signature: fieldSignature,
            grantzy_key: payload?.grantzyKey || ''
        }))
        .filter(item => item.field_signature && item.grantzy_key);
}

function buildFallbackFillPlan(memory = {}) {
    return buildFillPlan({
        formFields: latestScan?.fields || [],
        grantzyFields: flatGrantzyFields,
        memory
    }).map(item => ({
        ...item,
        enabled: item.status === 'auto' || item.status === 'needs_review' || item.status === 'manual'
    }));
}

function buildAiFillPlan(aiItems = [], formFields = []) {
    const matchByFieldId = new Map();
    const matchBySignature = new Map();

    aiItems.forEach(item => {
        if (!item || typeof item !== 'object') {
            return;
        }
        const fieldId = String(item.field_id || item.fieldId || '').trim();
        const fieldSignature = String(item.field_signature || item.fieldSignature || '').trim();
        if (fieldId) {
            matchByFieldId.set(fieldId, item);
        }
        if (fieldSignature) {
            matchBySignature.set(fieldSignature, item);
        }
    });

    return formFields.map((field, index) => {
        const aiItem = matchByFieldId.get(field.fieldId) || matchBySignature.get(field.signature) || null;
        const rawGrantzyKey = aiItem?.grantzy_key ?? aiItem?.grantzyKey ?? null;
        const grantzyKey = rawGrantzyKey ? String(rawGrantzyKey) : null;
        const grantzyKeyExists = grantzyKey
            ? flatGrantzyFields.some(item => item.key === grantzyKey)
            : false;
        const confidence = normalizeConfidence(aiItem?.confidence);
        let status = normalizeAiStatus(aiItem?.status, confidence, grantzyKeyExists ? grantzyKey : null);
        let reason = String(aiItem?.reason || (status === 'skipped' ? 'no_match' : 'semantic_label_match'));
        if (grantzyKey && !grantzyKeyExists) {
            status = 'skipped';
            reason = 'invalid_grantzy_key';
        }
        const candidateKeysRaw = Array.isArray(aiItem?.candidate_keys)
            ? aiItem.candidate_keys
            : (Array.isArray(aiItem?.candidateKeys) ? aiItem.candidateKeys : []);
        const candidateKeys = Array.from(
            new Set(
                candidateKeysRaw
                    .map(value => String(value || '').trim())
                    .filter(Boolean)
            )
        );

        let grantzyValue = grantzyKeyExists ? getGrantzyValueByKey(grantzyKey) : '';
        let dropdownOption = null;

        if (grantzyKeyExists && status !== 'skipped' && isDropdownField(field)) {
            const optionMatch = resolveOptionMatch(field, grantzyValue);
            dropdownOption = optionMatch.option;
            if (optionMatch.reason === 'no_options') {
                status = 'needs_review';
                reason = 'dropdown_options_not_detected';
            } else if (!optionMatch.option) {
                status = 'needs_review';
                reason = optionMatch.reason || reason;
            }
        }

        if (status === 'skipped') {
            grantzyValue = '';
            dropdownOption = null;
        }

        return {
            fieldId: field.fieldId,
            fieldSignature: field.signature,
            field,
            fieldLabel: getFieldLabel(field, index),
            widgetKind: field.widgetKind,
            inputType: field.inputType,
            grantzyKey: status === 'skipped' ? null : (grantzyKeyExists ? grantzyKey : null),
            grantzyValue,
            candidates: candidateKeys.map((key, candidateIndex) => ({
                key,
                value: getGrantzyValueByKey(key),
                score: Math.max(0, confidence - (candidateIndex * 0.05)),
                memoryBoost: 0
            })),
            confidence,
            status,
            reason,
            dropdownOption,
            enabled: status === 'auto' || status === 'needs_review' || status === 'manual'
        };
    });
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
    autofillPreviewEl.hidden = false;

    if (!currentFillPlan.length) {
        autofillPreviewEl.hidden = true;
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
        label.textContent = item.fieldLabel || t('field_label_with_index', { index: index + 1 });
        header.appendChild(label);
        header.appendChild(statusBadge(item.status));

        const meta = document.createElement('div');
        meta.textContent = t('confidence_widget_kind', {
            confidence: (item.confidence * 100).toFixed(0),
            widgetKind: item.field.widgetKind
        });

        const controls = document.createElement('div');
        controls.className = 'preview-controls';

        const select = document.createElement('select');
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = t('skip_field');
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
        valuePreview.textContent = t('value_preview', {
            value: item.grantzyValue || t('none')
        });

        main.appendChild(header);
        main.appendChild(meta);
        main.appendChild(controls);
        main.appendChild(valuePreview);

        if (isDropdownField(item.field)) {
            const dropdownNote = document.createElement('small');
            dropdownNote.textContent = item.dropdownOption
                ? t('option_label', { option: item.dropdownOption.text || item.dropdownOption.value })
                : t('option_not_matched');
            main.appendChild(dropdownNote);
        }

        const reason = document.createElement('small');
        reason.textContent = t('reason_label', {
            reason: item.reason || t('not_available')
        });
        main.appendChild(reason);

        row.appendChild(includeCheckbox);
        row.appendChild(main);
        autofillPreviewEl.appendChild(row);
    });

    updateActionButtons();
}

function renderFillReport(results = []) {
    autofillReportEl.innerHTML = '';
    autofillReportEl.hidden = false;

    if (!results.length) {
        autofillReportEl.hidden = true;
        return;
    }

    const summary = {
        filled: 0,
        skipped: 0,
        review: 0
    };

    results.forEach(result => {
        if (result.status === 'filled') {
            summary.filled += 1;
        } else {
            summary.skipped += 1;
        }

        if (result.reviewHighlighted) {
            summary.review += 1;
        }

        const line = document.createElement('div');
        const reviewSuffix = result.reviewHighlighted ? t('review_highlighted_suffix') : '';
        line.textContent = t('fill_report_line', {
            fieldId: result.fieldId,
            status: result.status,
            reason: result.reason || t('not_available'),
            reviewSuffix
        });
        autofillReportEl.appendChild(line);
    });

    const heading = document.createElement('div');
    heading.style.marginBottom = '6px';
    heading.style.fontWeight = 'bold';
    heading.textContent = t('fill_report_heading', {
        filled: summary.filled,
        review: summary.review,
        skipped: summary.skipped
    });
    autofillReportEl.prepend(heading);
}

function resetAutofillState() {
    latestScan = null;
    currentFillPlan = [];
    autofillReportEl.textContent = '';
    autofillReportEl.hidden = true;
    autofillPreviewEl.textContent = '';
    autofillPreviewEl.hidden = true;
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

    updateApplicationsCardHeader(selectedApplication);
    updateActionButtons();
    applyViewVisibility();
}

async function analyzeCurrentForm({ skipPermissionCheck = false } = {}) {
    if (!selectedApplication) {
        setAutofillStatus(t('select_application_first'), 'error');
        return false;
    }

    if (!skipPermissionCheck) {
        const hasPermission = await ensureActiveTabPermission();
        if (!hasPermission) {
            return false;
        }
    }

    setBusyState(true);
    setAutofillStatus(t('analyzing_fields_current_tab'));

    const response = await sendRuntimeMessage({ action: 'scanFormInActiveTab' });
    setBusyState(false);

    if (!response.success) {
        setAutofillStatus(response.error || t('could_not_analyze_form'), 'error');
        return false;
    }

    latestScan = {
        origin: response.origin,
        formFingerprint: response.formFingerprint,
        url: response.url,
        fields: Array.isArray(response.fields) ? response.fields : []
    };

    if (!latestScan.fields.length) {
        setAutofillStatus(t('no_fillable_fields_detected'), 'error');
        renderFillReport([]);
        currentFillPlan = [];
        renderFillPlan();
        return false;
    } else {
        setAutofillStatus(t('detected_fields_click_fill_or_preview', { count: latestScan.fields.length }), 'success');
    }

    renderFillReport([]);
    currentFillPlan = [];
    renderFillPlan();
    return true;
}

async function previewFillPlan({ skipPermissionCheck = false, suppressPreviewStatus = false } = {}) {
    if (!flatGrantzyFields.length) {
        await refreshFlatGrantzyFields();
    }

    if (!flatGrantzyFields.length) {
        setAutofillStatus(t('no_application_data_loaded_select_first'), 'error');
        return false;
    }

    if (!latestScan?.fields?.length) {
        const analyzed = await analyzeCurrentForm({ skipPermissionCheck });
        if (!analyzed || !latestScan?.fields?.length) {
            return false;
        }
    }

    setBusyState(true);
    if (!suppressPreviewStatus) {
        setAutofillStatus(t('building_autofill_preview'));
    }

    const memory = await loadMappingMemory(latestScan.origin, latestScan.formFingerprint);
    let usedFallback = false;
    let fallbackReason = '';

    if (selectedApplication?.uuid) {
        const aiResponse = await sendRuntimeMessage({
            action: 'matchFormFieldsWithAi',
            applicationId: selectedApplication.uuid,
            origin: latestScan.origin,
            url: latestScan.url,
            formFingerprint: latestScan.formFingerprint,
            fields: latestScan.fields,
            memoryHints: buildMemoryHints(memory)
        });

        if (aiResponse.success && Array.isArray(aiResponse.items) && aiResponse.items.length) {
            currentFillPlan = buildAiFillPlan(aiResponse.items, latestScan.fields);
        } else {
            usedFallback = true;
            fallbackReason = aiResponse.error || t('ai_matching_unavailable');
            currentFillPlan = buildFallbackFillPlan(memory);
        }
    } else {
        usedFallback = true;
        fallbackReason = t('no_selected_application_for_ai');
        currentFillPlan = buildFallbackFillPlan(memory);
    }

    setBusyState(false);
    renderFillPlan();

    const autoCount = currentFillPlan.filter(item => item.status === 'auto').length;
    const reviewCount = currentFillPlan.filter(item => item.status === 'needs_review').length;
    const skippedCount = currentFillPlan.filter(item => item.status === 'skipped').length;

    if (usedFallback) {
        if (!suppressPreviewStatus) {
            setAutofillStatus(
                t('ai_unavailable_using_fallback_preview_ready', {
                    reason: fallbackReason,
                    autoCount,
                    reviewCount,
                    skippedCount
                }),
                'success'
            );
        }
        return true;
    }

    if (!suppressPreviewStatus) {
        setAutofillStatus(
            t('ai_preview_ready', {
                autoCount,
                reviewCount,
                skippedCount
            }),
            'success'
        );
    }
    return true;
}

async function applyFillPlanToTab({ skipPermissionCheck = false } = {}) {
    const selectedItems = currentFillPlan.filter(item => item.enabled && item.grantzyKey);

    if (!selectedItems.length) {
        setAutofillStatus(t('select_at_least_one_field_to_fill'), 'error');
        return;
    }

    if (!skipPermissionCheck) {
        const hasPermission = await ensureActiveTabPermission();
        if (!hasPermission) {
            return;
        }
    }

    setBusyState(true);
    setAutofillStatus(t('applying_fields_count', { count: selectedItems.length }));

    const response = await sendRuntimeMessage({
        action: 'applyFillPlanInActiveTab',
        planItems: selectedItems
    });

    setBusyState(false);

    if (!response.success) {
        setAutofillStatus(response.error || t('failed_to_apply_fill_plan'), 'error');
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
    const reviewCount = results.filter(result => result.reviewHighlighted).length;
    const skippedCount = results.length - filledCount;
    setAutofillStatus(
        t('autofill_complete_summary', {
            filledCount,
            reviewCount,
            skippedCount
        }),
        'success'
    );
}

async function fillAllWithConfidenceTiers() {
    if (!selectedApplication) {
        setAutofillStatus(t('select_application_first'), 'error');
        return;
    }

    const hasPermission = await ensureActiveTabPermission();
    if (!hasPermission) {
        return;
    }

    if (!currentFillPlan.length) {
        setAutofillStatus(t('preparing_one_click_fill_all'));
        const hasPlan = await previewFillPlan({
            skipPermissionCheck: true,
            suppressPreviewStatus: true
        });
        if (!hasPlan || !currentFillPlan.length) {
            return;
        }
    }

    await applyFillPlanToTab({ skipPermissionCheck: true });
}

async function undoLastFill() {
    const hasPermission = await ensureActiveTabPermission();
    if (!hasPermission) {
        return;
    }

    setBusyState(true);
    setAutofillStatus(t('undoing_last_autofill_current_tab'));

    const response = await sendRuntimeMessage({ action: 'undoLastFillInActiveTab' });
    setBusyState(false);

    if (!response.success) {
        setAutofillStatus(response.error || t('undo_failed'), 'error');
        return;
    }

    setAutofillStatus(t('undo_completed_restored_fields', { count: response.undone || 0 }), 'success');
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
    updateApplicationsCardHeader(selectedApplication);
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

    if (sidebarEl) {
        sidebarEl.querySelectorAll('li').forEach(node => node.classList.remove('selected-root'));
    }

    selectedTreeNodeData = null;
    widgetEl.searchContextData = null;
    updateApplicationsCardHeader(selectedApplication);
}

function triggerSearchForSelectedNode() {
    if (!selectedTreeNodeData) {
        return;
    }

    const flattened = flattenFields(selectedTreeNodeData);
    updateDataResults(resultsContainer, flattened);
    resultsSelection(resultsContainer, searchInput);
}

function clearDataScope({ focusSearch = false } = {}) {
    if (!selectedApplication) {
        return;
    }

    clearSelectedTreeNode();

    if (flatGrantzyFields.length) {
        updateDataResults(resultsContainer, flatGrantzyFields);
        resultsSelection(resultsContainer, searchInput);
    }

    if (focusSearch) {
        searchInput.focus();
    }
}

function updateSidebar(nextSelectedApplication) {
    const previousApplicationUuid = selectedApplication?.uuid || null;
    selectedApplication = nextSelectedApplication || null;
    const nextApplicationUuid = selectedApplication?.uuid || null;
    const applicationChanged = previousApplicationUuid !== nextApplicationUuid;

    if (applicationChanged) {
        clearSelectedTreeNode();
    }

    containerEl.classList.toggle('has-selected-application', Boolean(selectedApplication));
    updateApplicationsCardHeader(selectedApplication);

    if (selectedApplication) {
        containerEl.classList.remove('no-sidebar');

        if (!sidebarEl) {
            sidebarEl = document.createElement('div');
            sidebarEl.classList.add('widget-sidebar');
            containerEl.insertBefore(sidebarEl, mainPanelEl);
        }

        sidebarEl.innerHTML = '';
        storageGet('selectedApplicationData').then(data => {
            if (data.selectedApplicationData?.fields) {
                const tree = renderTree(data.selectedApplicationData.fields);
                if (tree.querySelector('li')) {
                    sidebarEl.appendChild(tree);
                } else {
                    const noTreeData = document.createElement('p');
                    noTreeData.textContent = t('no_groups_found');
                    sidebarEl.appendChild(noTreeData);
                }
            } else {
                const noData = document.createElement('p');
                noData.textContent = t('no_data_available');
                sidebarEl.appendChild(noData);
            }
        });

        updateWidgetHeader(selectedApplication);
        backButton.style.display = 'block';
    } else {
        if (sidebarEl) {
            sidebarEl.remove();
            sidebarEl = null;
        }

        clearSelectedTreeNode();
        containerEl.classList.add('no-sidebar');
        updateWidgetHeader(null);
        backButton.style.display = 'none';
    }

    updateActionButtons();
    applyViewVisibility();
    if (!isBusy && !latestScan && !currentFillPlan.length) {
        setAutofillIdleStatus();
    }
}

async function disconnectFromSettings() {
    if (settingsDisconnectBtn) {
        settingsDisconnectBtn.disabled = true;
    }
    setSettingsStatus(t('disconnecting'), 'neutral');

    const response = await sendRuntimeMessage({ action: 'clearExtensionToken' });
    if (!response.success) {
        setSettingsStatus(response.error || t('could_not_disconnect'), 'error');
        if (settingsDisconnectBtn) {
            settingsDisconnectBtn.disabled = false;
        }
        return;
    }

    extensionSettings = response.settings || extensionSettings;
    showToast(t('disconnected'));
    await refreshConnectionStatus({ withSpinner: true });
    await refreshSettingsPanel();
}

function openGrantzySettings() {
    const settingsPath = '/accounts/settings/';
    const baseUrl = activeApiOriginLabel || 'https://grantzy.com';
    const url = `${baseUrl}${settingsPath}`;
    chrome.tabs.create({ url });
}

analyzeFormButton.addEventListener('click', analyzeCurrentForm);
previewFillButton.addEventListener('click', previewFillPlan);
applyFillButton.addEventListener('click', fillAllWithConfidenceTiers);
undoFillButton.addEventListener('click', undoLastFill);

applicationsViewButton?.addEventListener('click', () => {
    setActiveView('applications');
});
clearDataScopeButton?.addEventListener('click', () => {
    clearDataScope({ focusSearch: true });
});
quickAccessViewButton?.addEventListener('click', () => {
    setActiveView('quick_access');
});
settingsViewButton?.addEventListener('click', () => {
    setActiveView('settings');
});

settingsManageBtn?.addEventListener('click', () => {
    openGrantzySettings();
});
settingsDisconnectBtn?.addEventListener('click', () => {
    disconnectFromSettings();
});

if (recheckConnectionBtn) {
    recheckConnectionBtn.addEventListener('click', async () => {
        const session = await refreshConnectionStatus({ withSpinner: true });
        if (currentView === 'settings') {
            setSettingsStatus(
                session ? t('connection_refreshed_successfully') : t('connection_refresh_failed'),
                session ? 'success' : 'error'
            );
        }
    });
}

backButton.addEventListener('click', async () => {
    await storageRemove(['selectedApplication', 'selectedApplicationData']);
    updateSidebar(null);
    await refreshFlatGrantzyFields();
    resetAutofillState();
    setAutofillIdleStatus();

    resultsContainer.innerHTML = '';
    searchInput.disabled = false;
    searchInput.value = '';
    await setupApplicationsViewSearch();
    await renderQuickAccessPanel();
    await setActiveView('applications');
});

chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace !== 'local') {
        return;
    }

    if (changes.selectedApplication) {
        const previousApplicationUuid = selectedApplication?.uuid || null;
        const nextApplication = changes.selectedApplication.newValue || null;
        updateSidebar(nextApplication);
        const nextApplicationUuid = nextApplication?.uuid || null;
        if (previousApplicationUuid !== nextApplicationUuid) {
            flatGrantzyFields = [];
            resetAutofillState();
            setAutofillIdleStatus();
        }
        if (nextApplication) {
            await recordRecentApplication(nextApplication);
            await renderRecentApplicationsList();
        }
    }

    if (changes.selectedApplicationData) {
        await refreshFlatGrantzyFields();
        const data = await storageGet('selectedApplication');
        updateSidebar(data.selectedApplication);
        if (!latestScan && !currentFillPlan.length && !isBusy) {
            setAutofillIdleStatus();
        }
    }

    if (changes[RECENT_APPLICATIONS_KEY] && currentView === 'quick_access') {
        await renderRecentApplicationsList();
    }
});

(async () => {
    const data = await storageGet('selectedApplication');
    updateSidebar(data.selectedApplication);
    await refreshFlatGrantzyFields();
    resetAutofillState();
    setAutofillIdleStatus();
    await refreshSettingsPanel();
    await setupApplicationsViewSearch();
    await setActiveView('applications');
    await refreshConnectionStatus({ withSpinner: false });
    await renderQuickAccessPanel();
    applyViewVisibility();
})();
