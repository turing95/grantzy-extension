import {
    setupApplicationSearch,
    setupDataSearch,
    flattenFields,
    updateDataResults,
    updateResultsContainer,
    resultsSelection
} from './searchHandler.js';
import {
    buildFillPlan,
    isDropdownField,
    resolveOptionMatch
} from './fillPlanner.js';
import {
    loadMappingMemory,
    saveMappingMemory
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
const refreshDataButton = document.getElementById('refresh-data-btn');
const backButton = document.getElementById('back-button');
const connectionStatusEl = document.getElementById('connection-status');
const recheckConnectionBtn = document.getElementById('recheck-connection-btn');
const applicationsViewButton = document.getElementById('show-applications-view-btn');
const quickAccessViewButton = document.getElementById('show-quick-access-view-btn');
const scanPlatformViewButton = document.getElementById('show-scan-platform-view-btn');
const settingsViewButton = document.getElementById('show-settings-view-btn');
const applicationsViewEl = document.getElementById('applications-view');
const quickAccessViewEl = document.getElementById('quick-access-view');
const scanPlatformViewEl = document.getElementById('scan-platform-view');
const settingsViewEl = document.getElementById('settings-view');

// Platform Scan elements (staff-only)
const scanRunUuidInput = document.getElementById('scan-run-uuid-input');
const scanLoadRunBtn = document.getElementById('scan-load-run-btn');
const scanLoadStatusEl = document.getElementById('scan-load-status');
const scanLoadBlockEl = document.getElementById('scan-load-block');
const scanActiveBlockEl = document.getElementById('scan-active-block');
const scanActiveBandoEl = document.getElementById('scan-active-bando');
const scanActiveFillableEl = document.getElementById('scan-active-fillable');
const scanActivePortalEl = document.getElementById('scan-active-portal');
const scanActiveProgressEl = document.getElementById('scan-active-progress');
const scanActiveTabEl = document.getElementById('scan-active-tab');
const scanCaptureBtn = document.getElementById('scan-capture-btn');
const scanCaptureContextEl = document.getElementById('scan-capture-context');
const scanCaptureStatusEl = document.getElementById('scan-capture-status');
const scanRecentCapturesWrapEl = document.getElementById('scan-recent-captures-wrap');
const scanRecentCapturesListEl = document.getElementById('scan-recent-captures-list');
const scanTerminateBtn = document.getElementById('scan-terminate-btn');
const scanRestartBtn = document.getElementById('scan-restart-btn');
const scanClearRunBtn = document.getElementById('scan-clear-run-btn');
const recentApplicationsListEl = document.getElementById('recent-applications-list');
const settingsConnectionInfoEl = document.getElementById('settings-connection-info');
const settingsConnectedDetailsEl = document.getElementById('settings-connected-details');
const settingsUserDisplayEl = document.getElementById('settings-user-display');
const settingsNotConnectedPromptEl = document.getElementById('settings-not-connected-prompt');
const settingsManageBtn = document.getElementById('settings-manage-btn');
const settingsDisconnectBtn = document.getElementById('settings-disconnect-btn');

const applyFillButton = document.getElementById('apply-fill-btn');
const undoFillButton = document.getElementById('undo-fill-btn');
const autofillStatusEl = document.getElementById('autofill-status');
const autofillReportEl = document.getElementById('autofill-report');

const COLLAPSE_STATE_KEY = 'grantzyCollapseSectionsV1';
const topbarEl = widgetEl.querySelector('.widget-topbar');
const autofillPanelEl = document.getElementById('autofill-panel');

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
let activeFillSession = 0;
let currentView = 'applications';
let extensionSettings = null;
let activeApiOriginLabel = '';

// Platform scan state
let scanRunUuid = '';
let scanRunInfo = null;
let scanRecentCaptures = []; // [{ url, added, total, ts, fields:[{label,type}] }]
let isScanBusy = false;
const SCAN_RUN_STORAGE_KEY = 'grantzyPlatformScanRunV1';
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

    const strip = connectionStatusEl.closest('.connection-strip');
    if (strip) {
        strip.hidden = tone === 'ok';
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
    const canFill = hasApplication && flatGrantzyFields.length;

    applyFillButton.disabled = isBusy || !canFill;
    undoFillButton.disabled = isBusy;
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
            const scopeSuffix = scopeName ? t('scope_suffix', { scope: scopeName }) : '';
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

    if (refreshDataButton) {
        refreshDataButton.hidden = !nextApplication;
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
    scanPlatformViewEl?.classList.toggle('active', currentView === 'scan_platform');
    settingsViewEl?.classList.toggle('active', currentView === 'settings');

    applicationsViewButton?.classList.toggle('active', isApplicationsView);
    quickAccessViewButton?.classList.toggle('active', currentView === 'quick_access');
    scanPlatformViewButton?.classList.toggle('active', currentView === 'scan_platform');
    settingsViewButton?.classList.toggle('active', currentView === 'settings');

    if (searchInput) {
        searchInput.classList.toggle('hidden', !isApplicationsView);
    }

    const shouldShowSidebar = Boolean(sidebarEl) && isApplicationsView;
    containerEl.classList.toggle('no-sidebar', !shouldShowSidebar);
    containerEl.classList.toggle('has-selected-application', Boolean(selectedApplication) && isApplicationsView);

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
    } else if (nextView === 'scan_platform') {
        await renderScanPlatformPanel();
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

async function renderQuickAccessPanel() {
    await renderRecentApplicationsList();
}

async function refreshSettingsPanel() {
    setSettingsStatus(t('checking_connection'), 'neutral');

    if (settingsConnectedDetailsEl) {
        settingsConnectedDetailsEl.hidden = true;
    }
    if (settingsNotConnectedPromptEl) {
        settingsNotConnectedPromptEl.hidden = true;
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
            settingsConnectedDetailsEl.hidden = false;
        }
        if (settingsDisconnectBtn) {
            settingsDisconnectBtn.disabled = false;
        }
    } else {
        setSettingsStatus(t('not_connected'), 'error');
        if (settingsNotConnectedPromptEl) {
            settingsNotConnectedPromptEl.hidden = false;
        }
        if (settingsDisconnectBtn) {
            settingsDisconnectBtn.disabled = true;
        }
    }
}

// ------------------------------ Platform Scan ------------------------------

function setScanLoadStatus(message, level = 'neutral') {
    if (!scanLoadStatusEl) return;
    scanLoadStatusEl.textContent = message || '';
    scanLoadStatusEl.classList.remove('settings-status-success', 'settings-status-error', 'settings-status-neutral');
    scanLoadStatusEl.classList.add(`settings-status-${level}`);
}

function setScanCaptureStatus(message, level = 'neutral') {
    if (!scanCaptureStatusEl) return;
    scanCaptureStatusEl.textContent = message || '';
    scanCaptureStatusEl.classList.remove('settings-status-success', 'settings-status-error', 'settings-status-neutral');
    scanCaptureStatusEl.classList.add(`settings-status-${level}`);
}

function isUuidLike(value) {
    return UUID_PATTERN.test(String(value || '').trim());
}

async function refreshScanStaffGating() {
    if (!scanPlatformViewButton) return false;
    try {
        const session = await sendRuntimeMessage({ action: 'getExtensionSession' });
        const isStaff = Boolean(
            session?.success && session.session?.user
            && (session.session.user.is_staff || session.session.user.is_superuser),
        );
        scanPlatformViewButton.hidden = !isStaff;
        return isStaff;
    } catch (_err) {
        scanPlatformViewButton.hidden = true;
        return false;
    }
}

function showScanLoadBlock() {
    scanLoadBlockEl?.removeAttribute('hidden');
    scanActiveBlockEl?.setAttribute('hidden', '');
}

function showScanActiveBlock() {
    scanLoadBlockEl?.setAttribute('hidden', '');
    scanActiveBlockEl?.removeAttribute('hidden');
}

async function refreshActiveTabHint() {
    try {
        const tabInfo = await sendRuntimeMessage({ action: 'getActiveTabInfo' });
        if (tabInfo?.success && scanActiveTabEl) {
            scanActiveTabEl.textContent = t('scan_active_tab_url', { url: tabInfo.url || '' });
        }
    } catch (_err) {
        // best-effort; ignore
    }
}

function renderScanRunInfo() {
    if (!scanRunInfo) return;
    if (scanActiveBandoEl) {
        scanActiveBandoEl.textContent = scanRunInfo.bando?.name || '';
    }
    if (scanActiveFillableEl) {
        scanActiveFillableEl.textContent = `${t('scan_run_fillable')}: ${scanRunInfo.fillable?.name || ''}`;
    }
    if (scanActivePortalEl) {
        const url = scanRunInfo.portal_url || '';
        scanActivePortalEl.innerHTML = '';
        scanActivePortalEl.appendChild(document.createTextNode(`${t('scan_run_portal')}: `));
        if (url) {
            const link = document.createElement('a');
            link.href = url;
            link.textContent = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            scanActivePortalEl.appendChild(link);
        } else {
            scanActivePortalEl.appendChild(document.createTextNode(t('not_available')));
        }
    }
    if (scanActiveProgressEl) {
        scanActiveProgressEl.textContent = t('scan_run_progress', {
            captures: scanRunInfo.captures_count || 0,
            fields: scanRunInfo.fields_count || 0,
        });
    }
}

function renderRecentCaptures() {
    if (!scanRecentCapturesListEl || !scanRecentCapturesWrapEl) return;
    if (!scanRecentCaptures.length) {
        scanRecentCapturesWrapEl.hidden = true;
        return;
    }
    scanRecentCapturesWrapEl.hidden = false;
    scanRecentCapturesListEl.innerHTML = '';
    scanRecentCaptures.slice(0, 5).forEach((capture) => {
        const item = document.createElement('div');
        item.className = 'quick-card';
        const head = document.createElement('div');
        head.innerHTML = `<strong>+${capture.added}</strong> · ${capture.url || ''}`;
        item.appendChild(head);
        const fieldsEl = document.createElement('div');
        fieldsEl.className = 'text-muted';
        fieldsEl.textContent = (capture.fields || [])
            .slice(0, 6)
            .map(f => t('scan_capture_added_field_short', { label: f.label, type: f.type }))
            .join(' · ');
        item.appendChild(fieldsEl);
        scanRecentCapturesListEl.appendChild(item);
    });
}

async function loadScanRun(uuid) {
    setScanLoadStatus(t('scan_loading_run'), 'neutral');
    if (scanLoadRunBtn) scanLoadRunBtn.disabled = true;
    try {
        const response = await sendRuntimeMessage({
            action: 'platformScanRunInfo',
            scanRunUuid: uuid,
        });
        if (!response?.success) {
            throw new Error(response?.error || 'unknown error');
        }
        const info = response.info;
        if (info.status !== 'running') {
            setScanLoadStatus(
                t('scan_run_invalid_status', { status: info.status }),
                'error',
            );
            return false;
        }
        scanRunUuid = uuid;
        scanRunInfo = info;
        await storageSet({ [SCAN_RUN_STORAGE_KEY]: { uuid } });
        renderScanRunInfo();
        await refreshActiveTabHint();
        showScanActiveBlock();
        setScanLoadStatus(t('scan_run_loaded'), 'success');
        setScanCaptureStatus('', 'neutral');
        return true;
    } catch (err) {
        setScanLoadStatus(t('scan_run_not_found'), 'error');
        return false;
    } finally {
        if (scanLoadRunBtn) scanLoadRunBtn.disabled = false;
    }
}

async function captureCurrentPage() {
    if (!scanRunUuid || isScanBusy) return;
    isScanBusy = true;
    if (scanCaptureBtn) scanCaptureBtn.disabled = true;
    setScanCaptureStatus(t('scan_capturing'), 'neutral');
    try {
        // host_permissions: ["<all_urls>"] in manifest covers any portal
        // domain — no runtime permission request needed.
        const tabInfo = await sendRuntimeMessage({ action: 'getActiveTabInfo' });
        if (!tabInfo?.success || !tabInfo.scriptable) {
            throw new Error(t('open_regular_website_tab_before_autofill'));
        }
        const captureContext = (scanCaptureContextEl?.value || '').trim();
        const response = await sendRuntimeMessage({
            action: 'platformScanCapture',
            scanRunUuid,
            captureContext,
        });
        if (!response?.success) {
            throw new Error(response?.error || 'unknown error');
        }
        const capture = response.capture;
        scanRecentCaptures.unshift({
            url: capture?.captures_count ? scanRunInfo?.portal_url : '',
            added: capture.added,
            total: capture.total,
            ts: Date.now(),
            fields: capture.last_added || [],
        });
        if (scanRunInfo) {
            scanRunInfo.fields_count = capture.total;
            scanRunInfo.captures_count = capture.captures_count || (scanRunInfo.captures_count || 0) + 1;
        }
        renderScanRunInfo();
        renderRecentCaptures();
        setScanCaptureStatus(
            t('scan_capture_added', { added: capture.added, total: capture.total }),
            'success',
        );
        // Clear the context field so each capture has its own description
        if (scanCaptureContextEl) {
            scanCaptureContextEl.value = '';
        }
        await refreshActiveTabHint();
    } catch (err) {
        setScanCaptureStatus(
            t('scan_capture_failed', { error: err.message || 'errore' }),
            'error',
        );
    } finally {
        if (scanCaptureBtn) scanCaptureBtn.disabled = false;
        isScanBusy = false;
    }
}

async function terminateScanRun() {
    if (!scanRunUuid || isScanBusy) return;
    isScanBusy = true;
    if (scanTerminateBtn) scanTerminateBtn.disabled = true;
    setScanCaptureStatus(t('scan_terminating'), 'neutral');
    try {
        const response = await sendRuntimeMessage({
            action: 'platformScanCommit',
            scanRunUuid,
            status: 'completed',
        });
        if (!response?.success) {
            throw new Error(response?.error || 'unknown error');
        }
        setScanCaptureStatus(t('scan_terminated'), 'success');
        await clearScanRunState({ keepStatus: true });
    } catch (err) {
        setScanCaptureStatus(
            t('scan_terminate_failed', { error: err.message || 'errore' }),
            'error',
        );
    } finally {
        if (scanTerminateBtn) scanTerminateBtn.disabled = false;
        isScanBusy = false;
    }
}

async function clearScanRunState({ keepStatus = false } = {}) {
    scanRunUuid = '';
    scanRunInfo = null;
    scanRecentCaptures = [];
    if (scanRunUuidInput) scanRunUuidInput.value = '';
    renderRecentCaptures();
    showScanLoadBlock();
    if (!keepStatus) {
        setScanLoadStatus('', 'neutral');
        setScanCaptureStatus('', 'neutral');
    }
    await storageRemove([SCAN_RUN_STORAGE_KEY]);
}

async function renderScanPlatformPanel() {
    const isStaff = await refreshScanStaffGating();
    if (!isStaff) {
        setScanLoadStatus(t('scan_extension_only_for_staff'), 'error');
        showScanLoadBlock();
        return;
    }
    // Restore previous run uuid from storage
    if (!scanRunUuid) {
        const stored = await storageGet(SCAN_RUN_STORAGE_KEY);
        const previous = stored?.[SCAN_RUN_STORAGE_KEY];
        if (previous?.uuid && isUuidLike(previous.uuid)) {
            if (scanRunUuidInput) scanRunUuidInput.value = previous.uuid;
            const ok = await loadScanRun(previous.uuid);
            if (ok) return;
        }
    }
    if (scanRunUuid && scanRunInfo) {
        renderScanRunInfo();
        await refreshActiveTabHint();
        showScanActiveBlock();
    } else {
        showScanLoadBlock();
    }
}

scanLoadRunBtn?.addEventListener('click', async () => {
    const value = String(scanRunUuidInput?.value || '').trim();
    if (!isUuidLike(value)) {
        setScanLoadStatus(t('scan_run_not_found'), 'error');
        return;
    }
    await loadScanRun(value);
});

scanRunUuidInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        scanLoadRunBtn?.click();
    }
});

scanCaptureBtn?.addEventListener('click', () => {
    captureCurrentPage();
});

scanTerminateBtn?.addEventListener('click', () => {
    terminateScanRun();
});

scanRestartBtn?.addEventListener('click', async () => {
    if (!scanRunUuid || isScanBusy) return;
    if (!confirm('Annulla questa run e creane una nuova vuota per lo stesso fillable?')) return;
    isScanBusy = true;
    if (scanRestartBtn) scanRestartBtn.disabled = true;
    setScanCaptureStatus('Ricomincio da zero...', 'neutral');
    try {
        const r = await sendRuntimeMessage({ action: 'platformScanRestart', scanRunUuid });
        if (!r?.success) throw new Error(r?.error || 'restart failed');
        const newUuid = r.restart?.scan_run_uuid;
        if (!newUuid) throw new Error('backend did not return new scan_run_uuid');
        await clearScanRunState();
        if (scanRunUuidInput) scanRunUuidInput.value = newUuid;
        await loadScanRun(newUuid);
    } catch (err) {
        setScanCaptureStatus(`Restart fallito: ${err.message || 'errore'}`, 'error');
    } finally {
        if (scanRestartBtn) scanRestartBtn.disabled = false;
        isScanBusy = false;
    }
});

scanClearRunBtn?.addEventListener('click', () => {
    clearScanRunState();
});


function getGrantzyValueByKey(key) {
    const match = flatGrantzyFields.find(item => item.key === key);
    return match ? String(match.value ?? '') : '';
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
    return field?.label || field?.name || field?.idAttr || field?.placeholder || t('field_label_with_index', { index: index + 1 });
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
    activeFillSession = 0;
    autofillReportEl.textContent = '';
    autofillReportEl.hidden = true;
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

    setAutofillStatus(t('analyzing_fields_current_tab'));

    const response = await sendRuntimeMessage({ action: 'scanFormInActiveTab' });

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
        currentFillPlan = [];
        return false;
    }

    currentFillPlan = [];
    return true;
}

async function applyFillPlanToTab({ skipPermissionCheck = false, skipBusyState = false } = {}) {
    const selectedItems = currentFillPlan.filter(item => item.enabled && item.grantzyKey);

    if (!selectedItems.length) {
        setAutofillStatus(t('no_fields_matched'), 'error');
        return;
    }

    if (!skipPermissionCheck) {
        const hasPermission = await ensureActiveTabPermission();
        if (!hasPermission) {
            return;
        }
    }

    if (!skipBusyState) {
        setBusyState(true);
    }
    setAutofillStatus(t('applying_fields_count', { count: selectedItems.length }));

    const response = await sendRuntimeMessage({
        action: 'applyFillPlanInActiveTab',
        planItems: selectedItems
    });

    if (!skipBusyState) {
        setBusyState(false);
    }

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

    setBusyState(true);

    try {
        setAutofillStatus(t('magic_fill_scanning'));

        if (!flatGrantzyFields.length) {
            await refreshFlatGrantzyFields();
        }
        if (!flatGrantzyFields.length) {
            setAutofillStatus(t('no_application_data_loaded_select_first'), 'error');
            return;
        }

        const analyzed = await analyzeCurrentForm({ skipPermissionCheck: true });
        if (!analyzed || !latestScan?.fields?.length) {
            return;
        }

        setAutofillStatus(t('magic_fill_matching'));

        const fillSessionId = Date.now();
        activeFillSession = fillSessionId;

        const memory = await loadMappingMemory(latestScan.origin, latestScan.formFingerprint);
        const memoryHints = buildMemoryHints(memory);
        const hasMemory = memoryHints.length > 0;

        if (hasMemory) {
            currentFillPlan = buildFallbackFillPlan(memory);
            const memoryMatchedCount = currentFillPlan.filter(item => item.enabled && item.grantzyKey).length;

            if (memoryMatchedCount > 0) {
                setAutofillStatus(t('magic_fill_filling'));
                await applyFillPlanToTab({ skipPermissionCheck: true, skipBusyState: true });

                if (selectedApplication?.uuid) {
                    const filledSignatures = new Set(
                        currentFillPlan
                            .filter(item => item.enabled && item.grantzyKey)
                            .map(item => item.fieldSignature)
                    );
                    const unmatchedFields = latestScan.fields.filter(
                        field => !filledSignatures.has(field.signature)
                    );

                    if (unmatchedFields.length > 0) {
                        const savedSession = fillSessionId;
                        sendRuntimeMessage({
                            action: 'matchFormFieldsWithAi',
                            applicationId: selectedApplication.uuid,
                            origin: latestScan.origin,
                            url: latestScan.url,
                            formFingerprint: latestScan.formFingerprint,
                            fields: unmatchedFields,
                            memoryHints
                        }).then(async (aiResponse) => {
                            if (activeFillSession !== savedSession) return;
                            if (aiResponse.success && Array.isArray(aiResponse.items) && aiResponse.items.length) {
                                const extraPlan = buildAiFillPlan(aiResponse.items, unmatchedFields);
                                const extraItems = extraPlan.filter(item => item.enabled && item.grantzyKey);
                                if (extraItems.length > 0) {
                                    const previousPlan = currentFillPlan;
                                    currentFillPlan = extraItems;
                                    await applyFillPlanToTab({ skipPermissionCheck: true });
                                    currentFillPlan = [...previousPlan, ...extraItems];
                                }
                            }
                        }).catch(() => {});
                    }
                }

                return;
            }
        }

        if (selectedApplication?.uuid) {
            const aiResponse = await sendRuntimeMessage({
                action: 'matchFormFieldsWithAi',
                applicationId: selectedApplication.uuid,
                origin: latestScan.origin,
                url: latestScan.url,
                formFingerprint: latestScan.formFingerprint,
                fields: latestScan.fields,
                memoryHints
            });

            if (aiResponse.success && Array.isArray(aiResponse.items) && aiResponse.items.length) {
                currentFillPlan = buildAiFillPlan(aiResponse.items, latestScan.fields);
            } else {
                currentFillPlan = buildFallbackFillPlan(memory);
            }
        } else {
            currentFillPlan = buildFallbackFillPlan(memory);
        }

        if (!currentFillPlan.length || !currentFillPlan.some(item => item.enabled && item.grantzyKey)) {
            setAutofillStatus(t('no_fields_matched'), 'error');
            return;
        }

        setAutofillStatus(t('magic_fill_filling'));
        await applyFillPlanToTab({ skipPermissionCheck: true, skipBusyState: true });
    } catch (error) {
        setAutofillStatus(error?.message || t('failed_to_apply_fill_plan'), 'error');
    } finally {
        setBusyState(false);
    }
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
        const isFileField = item.value_type === 'file';
        const hasChildren = !isFileField && Boolean(
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
                const leafEntry = { key: item.key, value: item.value };
                if (item.value_type) leafEntry.value_type = item.value_type;
                setSelectedTreeNode([leafEntry], li);
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

let sidebarTreeData = null;

function normalizeTreeEntries(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
        return Object.keys(data).map(key => ({ key, value: data[key] }));
    }
    return [];
}

function treeEntryMatches(entry, query) {
    if (String(entry.key || '').toLowerCase().includes(query)) return true;
    const value = entry.value;
    if (value && typeof value !== 'object') {
        return String(value).toLowerCase().includes(query);
    }
    return false;
}

function treeHasDescendantMatch(entries, query) {
    for (const entry of entries) {
        if (treeEntryMatches(entry, query)) return true;
        if (entry.value && typeof entry.value === 'object') {
            const children = normalizeTreeEntries(entry.value);
            if (children.length && treeHasDescendantMatch(children, query)) return true;
        }
    }
    return false;
}

function highlightText(text, query) {
    const lower = text.toLowerCase();
    const idx = lower.indexOf(query);
    if (idx === -1) return document.createTextNode(text);
    const span = document.createElement('span');
    span.appendChild(document.createTextNode(text.slice(0, idx)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(idx, idx + query.length);
    span.appendChild(mark);
    span.appendChild(document.createTextNode(text.slice(idx + query.length)));
    return span;
}

function renderFilteredTree(data, query) {
    const ul = document.createElement('ul');
    const entries = normalizeTreeEntries(data);

    entries.forEach(item => {
        const rawChildData = item.value;
        const isFileField = item.value_type === 'file';
        const hasChildren = !isFileField && Boolean(
            rawChildData
            && typeof rawChildData === 'object'
            && (Array.isArray(rawChildData) ? rawChildData.length : Object.keys(rawChildData).length)
        );

        const selfMatches = treeEntryMatches(item, query);
        const childEntries = hasChildren ? normalizeTreeEntries(rawChildData) : [];
        const hasChildMatch = hasChildren && treeHasDescendantMatch(childEntries, query);

        if (!selfMatches && !hasChildMatch) return;

        const li = document.createElement('li');
        li.dataset.expanded = hasChildren ? 'true' : 'leaf';

        const labelButton = document.createElement('button');
        labelButton.type = 'button';
        labelButton.className = 'tree-label';

        const caret = document.createElement('span');
        caret.className = hasChildren ? 'tree-caret' : 'tree-caret leaf';
        caret.textContent = hasChildren ? '▸' : '•';
        labelButton.appendChild(caret);

        const textSpan = document.createElement('span');
        textSpan.className = 'tree-label-text';
        textSpan.title = item.key;
        if (selfMatches && item.key.toLowerCase().includes(query)) {
            textSpan.appendChild(highlightText(item.key, query));
        } else {
            textSpan.textContent = item.key;
        }
        labelButton.appendChild(textSpan);
        li.appendChild(labelButton);

        labelButton.addEventListener('click', event => {
            event.stopPropagation();
            if (!hasChildren) {
                const leafEntry = { key: item.key, value: item.value };
                if (item.value_type) leafEntry.value_type = item.value_type;
                setSelectedTreeNode([leafEntry], li);
                return;
            }
            if (li.dataset.expanded === 'true') {
                const childUl = Array.from(li.children).find(
                    child => child.tagName && child.tagName.toLowerCase() === 'ul'
                );
                if (childUl) li.removeChild(childUl);
                li.dataset.expanded = 'false';
            } else {
                const childUl = selfMatches
                    ? renderTree(normalizeTreeEntries(rawChildData))
                    : renderFilteredTree(rawChildData, query);
                li.appendChild(childUl);
                li.dataset.expanded = 'true';
            }
            setSelectedTreeNode(item.value, li);
        });

        if (hasChildren) {
            if (selfMatches && !hasChildMatch) {
                li.dataset.expanded = 'false';
            } else if (selfMatches) {
                const childUl = renderTree(normalizeTreeEntries(rawChildData));
                li.appendChild(childUl);
            } else {
                const childUl = renderFilteredTree(rawChildData, query);
                li.appendChild(childUl);
            }
        }

        ul.appendChild(li);
    });

    return ul;
}

function filterSidebarTree(container, query) {
    if (!sidebarTreeData) return;

    container.innerHTML = '';

    if (!query) {
        const tree = renderTree(sidebarTreeData);
        if (tree.querySelector('li')) {
            container.appendChild(tree);
        } else {
            const noData = document.createElement('p');
            noData.textContent = t('no_groups_found');
            container.appendChild(noData);
        }
        return;
    }

    const filteredTree = renderFilteredTree(sidebarTreeData, query);
    if (filteredTree.querySelector('li')) {
        container.appendChild(filteredTree);
    } else {
        const noResults = document.createElement('p');
        noResults.textContent = t('no_values_found_for_search');
        container.appendChild(noResults);
    }
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
    let rootLi = current.tagName.toLowerCase() === 'li' ? current : null;
    while (current.parentElement && !current.parentElement.classList.contains('widget-sidebar')) {
        current = current.parentElement;
        if (current.tagName.toLowerCase() === 'li') {
            rootLi = current;
        }
    }
    current = rootLi || selectedTreeNodeElement;

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

    updateApplicationsCardHeader(selectedApplication);

    if (selectedApplication) {
        containerEl.classList.remove('no-sidebar');

        if (!sidebarEl) {
            sidebarEl = document.createElement('div');
            sidebarEl.classList.add('widget-sidebar');
            containerEl.insertBefore(sidebarEl, mainPanelEl);
        }

        sidebarEl.innerHTML = '';

        const filterInput = document.createElement('input');
        filterInput.type = 'text';
        filterInput.className = 'sidebar-filter-input';
        filterInput.placeholder = t('filter_tree');
        filterInput.setAttribute('aria-label', t('filter_tree'));
        sidebarEl.appendChild(filterInput);

        const treeContainer = document.createElement('div');
        treeContainer.className = 'sidebar-tree-container';
        sidebarEl.appendChild(treeContainer);

        filterInput.addEventListener('input', () => {
            const query = filterInput.value.trim().toLowerCase();
            filterSidebarTree(treeContainer, query);
        });

        storageGet('selectedApplicationData').then(data => {
            if (data.selectedApplicationData?.fields) {
                sidebarTreeData = data.selectedApplicationData.fields;
                const tree = renderTree(sidebarTreeData);
                if (tree.querySelector('li')) {
                    treeContainer.appendChild(tree);
                } else {
                    const noTreeData = document.createElement('p');
                    noTreeData.textContent = t('no_groups_found');
                    treeContainer.appendChild(noTreeData);
                }
            } else {
                sidebarTreeData = null;
                const noData = document.createElement('p');
                noData.textContent = t('no_data_available');
                treeContainer.appendChild(noData);
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

applyFillButton.addEventListener('click', fillAllWithConfidenceTiers);
undoFillButton.addEventListener('click', undoLastFill);

applicationsViewButton?.addEventListener('click', () => {
    setActiveView('applications');
});
clearDataScopeButton?.addEventListener('click', () => {
    clearDataScope({ focusSearch: true });
});
refreshDataButton?.addEventListener('click', async () => {
    if (!selectedApplication?.uuid || refreshDataButton.disabled) {
        return;
    }
    refreshDataButton.disabled = true;
    refreshDataButton.classList.add('spinning');

    const overlay = document.createElement('div');
    overlay.className = 'refresh-overlay';
    const spinner = document.createElement('span');
    spinner.className = 'loader-spinner';
    overlay.appendChild(spinner);
    overlay.appendChild(document.createTextNode(t('refreshing_data')));
    resultsContainer.appendChild(overlay);

    try {
        const response = await sendRuntimeMessage({
            action: 'fetchApplicationData',
            applicationId: selectedApplication.uuid
        });

        if (!response?.success) {
            throw new Error(response?.error || t('could_not_load_application_data'));
        }

        const rawFields = response.data?.fields || [];
        const flattenedServerFields = Array.isArray(response.data?.flat_fields)
            ? response.data.flat_fields : null;
        const fields = flattenedServerFields || flattenFields(rawFields);

        await storageSet({
            selectedApplicationData: {
                fields: rawFields,
                flatFields: flattenedServerFields,
                updatedAt: response.data?.updated_at || null
            }
        });

        updateResultsContainer(resultsContainer, fields, widgetEl, searchInput);
        resultsSelection(resultsContainer, searchInput);
        await refreshFlatGrantzyFields();
        searchInput.value = '';
        showToast(t('data_refreshed'));
    } catch (error) {
        overlay.remove();
        showToast(error.message || t('could_not_load_application_data'));
    }

    refreshDataButton.disabled = false;
    refreshDataButton.classList.remove('spinning');
});
quickAccessViewButton?.addEventListener('click', () => {
    setActiveView('quick_access');
});
scanPlatformViewButton?.addEventListener('click', () => {
    setActiveView('scan_platform');
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

    if (changes.grantzyPreloadingSpace?.newValue) {
        await setActiveView('applications');
        resultsContainer.innerHTML = '';
        searchInput.disabled = true;
        const loader = document.createElement('div');
        loader.className = 'loader loading-fullscreen';
        const spinner = document.createElement('span');
        spinner.className = 'loader-spinner';
        loader.appendChild(spinner);
        loader.appendChild(document.createTextNode(t('loading_application_fields')));
        resultsContainer.appendChild(loader);
        setAutofillStatus(t('loading_application_fields'));
    }

    if (changes.selectedApplication) {
        const previousApplicationUuid = selectedApplication?.uuid || null;
        const nextApplication = changes.selectedApplication.newValue || null;
        const nextApplicationUuid = nextApplication?.uuid || null;
        if (nextApplication) {
            await setActiveView('applications');
        }
        updateSidebar(nextApplication);
        if (previousApplicationUuid !== nextApplicationUuid) {
            flatGrantzyFields = [];
            resetAutofillState();
            setAutofillIdleStatus();
        }
        resultsContainer.innerHTML = '';
        if (nextApplication) {
            await recordRecentApplication(nextApplication);
            await renderRecentApplicationsList();
        }
    }

    if (changes.selectedApplicationData) {
        await refreshFlatGrantzyFields();
        const data = await storageGet(['selectedApplication', 'selectedApplicationData']);
        updateSidebar(data.selectedApplication);
        if (data.selectedApplication?.uuid && data.selectedApplicationData?.fields) {
            const storedData = data.selectedApplicationData;
            const fields = Array.isArray(storedData.flatFields)
                ? storedData.flatFields
                : flattenFields(storedData.fields);
            resultsContainer.innerHTML = '';
            updateResultsContainer(resultsContainer, fields, widgetEl, searchInput);
            resultsSelection(resultsContainer, searchInput);
            updateWidgetHeader(data.selectedApplication);
            backButton.style.display = 'block';
            searchInput.disabled = false;
            searchInput.value = '';
        }
        if (!latestScan && !currentFillPlan.length && !isBusy) {
            setAutofillIdleStatus();
        }
    }

    if (changes[RECENT_APPLICATIONS_KEY] && currentView === 'quick_access') {
        await renderRecentApplicationsList();
    }
});

chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === '__activeTabUrlChanged') {
        if (latestScan || currentFillPlan.length) {
            resetAutofillState();
            setAutofillIdleStatus();
        }
    }
});

// ── Collapsible sections ──

const collapsibleEls = { topbar: topbarEl, autofill: autofillPanelEl };

function applyCollapseState(key, collapsed) {
    const el = collapsibleEls[key];
    if (!el) return;
    const toggle = el.querySelector('.collapse-toggle');
    el.classList.toggle('collapsed', collapsed);
    if (toggle) {
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', collapsed ? t('expand_section') : t('collapse_section'));
    }
}

async function loadCollapseState() {
    const data = await storageGet(COLLAPSE_STATE_KEY);
    const state = data[COLLAPSE_STATE_KEY] || {};
    for (const key of Object.keys(collapsibleEls)) {
        applyCollapseState(key, !!state[key]);
    }
}

async function saveCollapseState() {
    const state = {};
    for (const key of Object.keys(collapsibleEls)) {
        state[key] = collapsibleEls[key]?.classList.contains('collapsed') || false;
    }
    await storageSet({ [COLLAPSE_STATE_KEY]: state });
}

function toggleCollapse(key) {
    const el = collapsibleEls[key];
    if (!el) return;
    const next = !el.classList.contains('collapsed');
    applyCollapseState(key, next);
    saveCollapseState();
}

for (const [key, el] of Object.entries(collapsibleEls)) {
    const toggle = el?.querySelector('.collapse-toggle');
    if (toggle) toggle.addEventListener('click', () => toggleCollapse(key));
}

(async () => {
    const initData = await storageGet(['selectedApplication', 'selectedApplicationData', 'grantzyPreloadingSpace']);
    updateSidebar(initData.selectedApplication);
    await loadCollapseState();
    await refreshFlatGrantzyFields();
    resetAutofillState();
    setAutofillIdleStatus();
    await refreshSettingsPanel();
    await refreshScanStaffGating();
    await setActiveView('applications');
    await refreshConnectionStatus({ withSpinner: false });
    await renderQuickAccessPanel();

    if (initData.selectedApplication?.uuid && initData.selectedApplicationData?.fields) {
        const storedData = initData.selectedApplicationData;
        const fields = Array.isArray(storedData.flatFields)
            ? storedData.flatFields
            : flattenFields(storedData.fields);
        updateResultsContainer(resultsContainer, fields, widgetEl, searchInput);
        resultsSelection(resultsContainer, searchInput);
        updateWidgetHeader(initData.selectedApplication);
        backButton.style.display = 'block';
        searchInput.disabled = false;
        searchInput.value = '';
        if (initData.grantzyPreloadingSpace) {
            chrome.storage.local.remove('grantzyPreloadingSpace');
        }
    } else if (initData.grantzyPreloadingSpace && !initData.selectedApplication) {
        resultsContainer.innerHTML = '';
        searchInput.disabled = true;
        searchInput.placeholder = '';
        const loader = document.createElement('div');
        loader.className = 'loader loading-fullscreen';
        const spinner = document.createElement('span');
        spinner.className = 'loader-spinner';
        loader.appendChild(spinner);
        loader.appendChild(document.createTextNode(t('loading_application_fields')));
        resultsContainer.appendChild(loader);
        setAutofillStatus(t('loading_application_fields'));
        setTimeout(() => {
            storageGet('grantzyPreloadingSpace').then(data => {
                if (data.grantzyPreloadingSpace) {
                    chrome.storage.local.remove('grantzyPreloadingSpace');
                    setupApplicationsViewSearch();
                    searchInput.disabled = false;
                }
            });
        }, 60000);
    } else {
        await setupApplicationsViewSearch();
        if (initData.grantzyPreloadingSpace) {
            chrome.storage.local.remove('grantzyPreloadingSpace');
        }
    }

    applyViewVisibility();
})();
