import {
    setupApplicationSearch,
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
    saveMappingMemory
} from './mappingMemory.js';

const searchInput = document.getElementById('app-search-input');
const resultsContainer = document.getElementById('app-search-results');
const widgetEl = document.getElementById('grantzy-sidepanel');
const containerEl = widgetEl.querySelector('.widget-container');
const mainPanelEl = document.getElementById('main-panel');
const headerEl = widgetEl.querySelector('.widget-header');
const backButton = document.getElementById('back-button');

const analyzeFormButton = document.getElementById('analyze-form-btn');
const previewFillButton = document.getElementById('preview-fill-btn');
const applyFillButton = document.getElementById('apply-fill-btn');
const undoFillButton = document.getElementById('undo-fill-btn');
const autofillStatusEl = document.getElementById('autofill-status');
const autofillPreviewEl = document.getElementById('autofill-preview');
const autofillReportEl = document.getElementById('autofill-report');

widgetEl.searchContextData = null;

let sidebarEl = null;
let selectedTreeNodeElement = null;
let selectedTreeNodeData = null;
let selectedApplication = null;

let flatGrantzyFields = [];
let latestScan = null;
let currentFillPlan = [];
let isBusy = false;

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
        flatGrantzyFields = flattenFields(data.selectedApplicationData.fields);
    } else {
        flatGrantzyFields = [];
    }

    updateActionButtons();
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
        await saveMappingMemory(latestScan.origin, latestScan.formFingerprint, memoryItems);
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
        let childData = item.value;
        let hasChildren = false;
        if (childData && typeof childData === 'object') {
            if (Array.isArray(childData)) {
                hasChildren = childData.length > 0;
            } else {
                hasChildren = Object.keys(childData).length > 0;
            }
        }

        const li = document.createElement('li');
        li.textContent = item.key;
        li.style.cursor = 'pointer';
        li.dataset.expanded = hasChildren ? 'false' : 'leaf';

        li.addEventListener('click', event => {
            event.stopPropagation();

            if (!hasChildren) {
                const leafNodeData = [{ key: item.key, value: item.value }];
                setSelectedTreeNode(leafNodeData, li);
                return;
            }

            Array.from(li.parentElement.children).forEach(sibling => {
                if (sibling !== li && sibling.dataset.expanded === 'true') {
                    const childUl = sibling.querySelector('ul');
                    if (childUl) sibling.removeChild(childUl);
                    sibling.dataset.expanded = 'false';
                    sibling.classList.remove('selected');
                }
            });

            if (li.dataset.expanded === 'false') {
                if (childData && typeof childData === 'object') {
                    if (!Array.isArray(childData)) {
                        childData = Object.keys(childData).map(key => ({ key, value: childData[key] }));
                    }
                    const childUl = renderTree(childData);
                    li.appendChild(childUl);
                }
                li.dataset.expanded = 'true';
                setSelectedTreeNode(item.value, li);
            } else {
                const childUl = li.querySelector('ul');
                if (childUl) li.removeChild(childUl);
                li.dataset.expanded = 'false';
                if (selectedTreeNodeElement === li) {
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
                noData.textContent = 'No data available';
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
}

analyzeFormButton.addEventListener('click', analyzeCurrentForm);
previewFillButton.addEventListener('click', previewFillPlan);
applyFillButton.addEventListener('click', applyFillPlanToTab);
undoFillButton.addEventListener('click', undoLastFill);

setupApplicationSearch(searchInput, resultsContainer, widgetEl);

backButton.addEventListener('click', () => {
    chrome.storage.local.remove(['selectedApplication', 'selectedApplicationData'], async () => {
        updateSidebar(null);
        await refreshFlatGrantzyFields();
        resetAutofillState();
        setAutofillStatus('Select an application and click Analyze Current Form.');

        resultsContainer.innerHTML = '';
        searchInput.disabled = false;
        searchInput.value = '';
        setupApplicationSearch(searchInput, resultsContainer, widgetEl);
    });
});

chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace !== 'local') {
        return;
    }

    if (changes.selectedApplication) {
        updateSidebar(changes.selectedApplication.newValue);
    }

    if (changes.selectedApplicationData) {
        await refreshFlatGrantzyFields();
        chrome.storage.local.get('selectedApplication', data => {
            updateSidebar(data.selectedApplication);
        });
    }
});

chrome.storage.local.get('selectedApplication', async data => {
    updateSidebar(data.selectedApplication);
    await refreshFlatGrantzyFields();
    resetAutofillState();
    setAutofillStatus('Select an application and click Analyze Current Form.');
});
