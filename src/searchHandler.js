import {
    addUniqueEventListener,
    debounce,
    levenshteinDistance,
    normalizeString,
    normalizeTokens
} from './utils.js';

const APPLICATION_SEARCH_LIMIT = 40;

let latestApplicationRequestId = 0;
let cachedApplications = [];

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

function dedupeApplications(sourceApplications) {
    const seen = new Set();
    return sourceApplications.filter(application => {
        const key = String(application?.uuid || `${application?.title || ''}-${application?.company_name || ''}`);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function describeApplicationTimestamp(isoTimestamp) {
    if (!isoTimestamp) {
        return '';
    }

    const date = new Date(isoTimestamp);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const delta = date.getTime() - Date.now();
    const absMilliseconds = Math.abs(delta);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

    if (absMilliseconds < 60_000) {
        return 'updated just now';
    }
    if (absMilliseconds < 3_600_000) {
        return `updated ${rtf.format(Math.round(delta / 60_000), 'minute')}`;
    }
    if (absMilliseconds < 86_400_000) {
        return `updated ${rtf.format(Math.round(delta / 3_600_000), 'hour')}`;
    }
    if (absMilliseconds < 2_592_000_000) {
        return `updated ${rtf.format(Math.round(delta / 86_400_000), 'day')}`;
    }

    return `updated ${rtf.format(Math.round(delta / 2_592_000_000), 'month')}`;
}

function formatDataValue(value) {
    if (value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch (_error) {
            return '[object]';
        }
    }

    return String(value);
}

function shouldDisplayDataRow(result) {
    const key = String(result?.key || '').trim().toLowerCase();
    if (!key) {
        return false;
    }

    // Internal helper field that usually expands to a huge structural list.
    if (key.includes('hidden fields choice')) {
        return false;
    }

    return true;
}

function compactDisplayValue(value, maxLength = 180) {
    const normalized = String(value || '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!normalized) {
        return '';
    }

    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength - 1)}…`;
}

async function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
}

function renderStateCard(container, message, {
    tone = 'neutral',
    actionLabel = '',
    onAction = null
} = {}) {
    container.innerHTML = '';

    const card = document.createElement('div');
    card.className = `state-card state-${tone}`;

    const text = document.createElement('div');
    text.className = 'state-message';
    text.textContent = message;
    card.appendChild(text);

    if (actionLabel && typeof onAction === 'function') {
        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.className = 'state-action';
        actionButton.textContent = actionLabel;
        actionButton.addEventListener('click', onAction);
        card.appendChild(actionButton);
    }

    container.appendChild(card);
}

function appendInlineNotice(container, message, actionLabel = '', onAction = null) {
    const notice = document.createElement('div');
    notice.className = 'inline-notice';

    const text = document.createElement('span');
    text.textContent = message;
    notice.appendChild(text);

    if (actionLabel && typeof onAction === 'function') {
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'inline-notice-action';
        action.textContent = actionLabel;
        action.addEventListener('click', onAction);
        notice.appendChild(action);
    }

    container.appendChild(notice);
}

function showNoResults(container, message) {
    renderStateCard(container, message, { tone: 'neutral' });
}

function showErrorState(container, message, onRetry) {
    renderStateCard(container, message, {
        tone: 'error',
        actionLabel: 'Retry',
        onAction: onRetry
    });
}

function setLoadMoreBusy(container, isBusy) {
    const loadMoreButton = container.querySelector('[data-role="load-more-applications"]');
    if (!loadMoreButton) {
        return;
    }

    loadMoreButton.disabled = isBusy;
    loadMoreButton.textContent = isBusy ? 'Loading more...' : 'Load more applications';
}

function rankApplications(query, sourceApplications) {
    const normalizedQuery = normalizeString(query);
    if (!normalizedQuery) {
        return sourceApplications;
    }

    const rankedResults = sourceApplications
        .map(application => {
            const titleRelevance = calculateRelevance(normalizedQuery, normalizeString(application.title));
            const companyRelevance = calculateRelevance(normalizedQuery, normalizeString(application.company_name));
            return {
                application,
                relevance: Math.max(titleRelevance, companyRelevance)
            };
        })
        .filter(result => result.relevance >= 1.2)
        .sort((a, b) => b.relevance - a.relevance);

    return rankedResults.map(item => item.application);
}

export async function fetchApplications({
    query = '',
    limit = APPLICATION_SEARCH_LIMIT,
    cursor = 0,
    organizationUuid = ''
} = {}) {
    const requestId = ++latestApplicationRequestId;
    const response = await sendRuntimeMessage({
        action: 'fetchApplications',
        query,
        limit,
        cursor,
        organizationUuid
    });

    if (requestId !== latestApplicationRequestId) {
        return {
            applications: [],
            nextCursor: null,
            stale: true,
            source: null
        };
    }

    if (!response.success) {
        throw new Error(response.error || 'Could not fetch applications');
    }

    const batch = Array.isArray(response.applications) ? response.applications : [];
    if (cursor === 0) {
        cachedApplications = batch;
    } else {
        cachedApplications = dedupeApplications([...cachedApplications, ...batch]);
    }

    return {
        applications: batch,
        nextCursor: response.nextCursor ?? null,
        stale: false,
        source: response.source || null
    };
}

export function setupApplicationSearch(searchInput, resultsContainer, contextHolder, callback) {
    searchInput.placeholder = 'Search applications...';

    if (searchInput._applicationSearchListener) {
        searchInput.removeEventListener('input', searchInput._applicationSearchListener);
        delete searchInput._applicationSearchListener;
    }
    if (searchInput._dataSearchListener) {
        searchInput.removeEventListener('input', searchInput._dataSearchListener);
        delete searchInput._dataSearchListener;
    }
    searchInput._dataSearchAttached = false;
    contextHolder.searchContextData = null;

    let currentQuery = '';
    let nextCursor = 0;
    let mergedResults = [];
    let loadingMore = false;

    const runSearch = async ({ append = false } = {}) => {
        const nextQuery = searchInput.value.toLowerCase().trim();

        if (!append) {
            currentQuery = nextQuery;
            nextCursor = 0;
            mergedResults = [];
            resultsContainer.innerHTML = '';
            const loader = createLoader(currentQuery ? 'Searching applications...' : 'Loading recent applications...');
            resultsContainer.appendChild(loader);
        } else if (loadingMore || nextCursor === null) {
            return;
        }

        if (append) {
            loadingMore = true;
            setLoadMoreBusy(resultsContainer, true);
        }

        try {
            const response = await fetchApplications({
                query: currentQuery,
                limit: APPLICATION_SEARCH_LIMIT,
                cursor: append ? nextCursor : 0,
                organizationUuid: String(contextHolder?.activeOrganizationUuid || '').trim()
            });

            if (response.stale) {
                return;
            }

            const batch = Array.isArray(response.applications) ? response.applications : [];
            mergedResults = append
                ? dedupeApplications([...mergedResults, ...batch])
                : dedupeApplications(batch);
            nextCursor = response.nextCursor;

            if (!mergedResults.length) {
                showNoResults(
                    resultsContainer,
                    currentQuery ? 'No applications match your search.' : 'No applications available for this account.'
                );
                return;
            }

            const ordered = rankApplications(currentQuery, mergedResults);
            updateApplicationResults(resultsContainer, ordered, searchInput, contextHolder, {
                hasMore: nextCursor !== null,
                onLoadMore: () => runSearch({ append: true })
            });
            resultsSelection(resultsContainer, searchInput);
        } catch (error) {
            const errorMessage = error.message || 'Could not load applications.';

            if (!append && cachedApplications.length && currentQuery) {
                const fallback = rankApplications(currentQuery, cachedApplications).slice(0, APPLICATION_SEARCH_LIMIT);
                if (fallback.length) {
                    updateApplicationResults(resultsContainer, fallback, searchInput, contextHolder, {
                        hasMore: false
                    });
                    appendInlineNotice(resultsContainer, 'Showing cached results. Connection may be unstable.', 'Retry', () => {
                        runSearch({ append: false });
                    });
                    resultsSelection(resultsContainer, searchInput);
                    return;
                }
            }

            showErrorState(resultsContainer, errorMessage, () => runSearch({ append: false }));
        } finally {
            if (append) {
                loadingMore = false;
                setLoadMoreBusy(resultsContainer, false);
            }
        }
    };

    const debouncedSearch = debounce(() => {
        runSearch({ append: false });
    }, 180);

    searchInput.addEventListener('input', debouncedSearch);
    searchInput._applicationSearchListener = debouncedSearch;

    // Prime the list with most recently updated applications.
    debouncedSearch();

    if (callback) {
        callback();
    }
}

export function setupDataSearch(searchInput, resultsContainer, applicationId, contextHolder, callback) {
    if (searchInput._applicationSearchListener) {
        searchInput.removeEventListener('input', searchInput._applicationSearchListener);
        delete searchInput._applicationSearchListener;
    }
    if (searchInput._dataSearchListener) {
        searchInput.removeEventListener('input', searchInput._dataSearchListener);
        delete searchInput._dataSearchListener;
    }

    searchInput._dataSearchAttached = false;
    contextHolder.searchContextData = null;
    searchInput.placeholder = 'Search data...';

    resultsContainer.innerHTML = '';
    resultsContainer.appendChild(createLoader('Loading application data...'));

    chrome.runtime.sendMessage({ action: 'fetchApplicationData', applicationId }, response => {
        if (chrome.runtime.lastError) {
            console.error('Message Error:', chrome.runtime.lastError);
            showErrorState(
                resultsContainer,
                chrome.runtime.lastError.message || 'Could not load application data.',
                () => setupDataSearch(searchInput, resultsContainer, applicationId, contextHolder, callback)
            );
            if (callback) callback();
            return;
        }

        if (!response?.success) {
            showErrorState(
                resultsContainer,
                response?.error || 'Could not load application data.',
                () => setupDataSearch(searchInput, resultsContainer, applicationId, contextHolder, callback)
            );
            if (callback) callback();
            return;
        }

        const rawFields = response.data?.fields || [];
        const flattenedServerFields = Array.isArray(response.data?.flat_fields) ? response.data.flat_fields : null;
        const fields = flattenedServerFields || flattenFields(rawFields);

        chrome.storage.local.set({
            selectedApplicationData: {
                fields: rawFields,
                flatFields: flattenedServerFields,
                updatedAt: response.data?.updated_at || null
            }
        });

        updateResultsContainer(resultsContainer, fields, contextHolder, searchInput);
        resultsSelection(resultsContainer, searchInput);
        if (callback) callback();
    });
}

export function updateApplicationResults(container, results, searchInput, contextHolder, options = {}) {
    const {
        hasMore = false,
        onLoadMore = null
    } = options;

    container.innerHTML = '';

    if (!results.length) {
        showNoResults(container, 'No applications found.');
        return;
    }

    results.forEach((result, index) => {
        const details = [result.company_name, describeApplicationTimestamp(result.updated_at)]
            .filter(Boolean)
            .join(' • ');

        const resultItem = createResultItem(result.title || 'Untitled application', details, {
            metadata: 'Open application data'
        });

        resultItem.addEventListener('click', () => {
            chrome.storage.local.set({
                selectedApplication: {
                    uuid: result.uuid,
                    title: result.title,
                    companyName: result.company_name,
                    updatedAt: result.updated_at || null
                }
            }, () => {
                const panelRoot = container.closest('#grantzy-sidepanel') || document;
                const header = panelRoot.querySelector('.widget-header');
                const backButton = panelRoot.querySelector('#back-button');
                container.innerHTML = '';
                const loader = createLoader('Loading application data...');
                searchInput.disabled = true;
                container.appendChild(loader);

                setupDataSearch(searchInput, container, result.uuid, contextHolder, () => {
                    loader.remove();
                    header.textContent = `Application selected: ${result.title} | ${result.company_name}`;
                    backButton.style.display = 'block';
                    searchInput.disabled = false;
                    searchInput.value = '';
                    searchInput.focus();
                });
            });
        });
        resultItem.addEventListener('mouseover', () => {
            setHoveredResult(resultItem, container);
        });
        container.appendChild(resultItem);
        if (index === 0) {
            setHoveredResult(resultItem, container);
        }
    });

    if (hasMore && typeof onLoadMore === 'function') {
        const pagination = document.createElement('div');
        pagination.className = 'result-pagination';

        const loadMoreButton = document.createElement('button');
        loadMoreButton.type = 'button';
        loadMoreButton.className = 'result-pagination-btn';
        loadMoreButton.dataset.role = 'load-more-applications';
        loadMoreButton.textContent = 'Load more applications';
        loadMoreButton.addEventListener('click', onLoadMore);

        pagination.appendChild(loadMoreButton);
        container.appendChild(pagination);
    }
}

export function updateResultsContainer(container, data, contextHolder, searchInput) {
    container.innerHTML = '';

    if (searchInput._dataSearchListener) {
        searchInput.removeEventListener('input', searchInput._dataSearchListener);
        delete searchInput._dataSearchListener;
    }

    const dataSearchListener = debounce(() => {
        const query = searchInput.value.toLowerCase().trim();
        const dataToSearch = contextHolder.searchContextData
            ? flattenFields(contextHolder.searchContextData)
            : data;

        if (!query) {
            updateDataResults(container, dataToSearch);
            resultsSelection(container, searchInput);
            return;
        }

        const normalizedQuery = normalizeString(query);
        const rankedResults = dataToSearch
            .map(item => ({
                item,
                relevance: Math.max(
                    calculateRelevance(normalizedQuery, normalizeString(item.key)),
                    calculateRelevance(normalizedQuery, normalizeString(formatDataValue(item.value)))
                )
            }))
            .filter(result => result.relevance >= 1.1)
            .sort((a, b) => b.relevance - a.relevance);
        updateDataResults(container, rankedResults.map(entry => entry.item));
        resultsSelection(container, searchInput);
    }, 90);

    searchInput.addEventListener('input', dataSearchListener);
    searchInput._dataSearchListener = dataSearchListener;
    searchInput._dataSearchAttached = true;

    updateDataResults(container, data);
}

function showToast(message, duration = 2200) {
    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.textContent = message;

    document.body.appendChild(toast);

    window.setTimeout(() => {
        toast.classList.add('hiding');
        window.setTimeout(() => {
            toast.remove();
        }, 250);
    }, duration);
}

export function updateDataResults(container, results) {
    container.innerHTML = '';
    const normalizedResults = Array.isArray(results)
        ? results.filter(shouldDisplayDataRow)
        : [];

    if (!normalizedResults.length) {
        showNoResults(container, 'No values found for this search.');
        return;
    }

    normalizedResults.forEach((result, index) => {
        const resultValue = formatDataValue(result.value);
        const displayValue = compactDisplayValue(resultValue);
        const resultItem = createResultItem(result.key, resultValue, {
            metadata: 'Click to copy value',
            displayValue
        });

        resultItem.addEventListener('click', async () => {
            try {
                await copyToClipboard(resultValue);
                showToast('Copied to clipboard');
            } catch (error) {
                console.error('Failed to copy text:', error);
                showToast('Copy failed');
            }
        });

        resultItem.addEventListener('mouseover', () => {
            setHoveredResult(resultItem, container);
        });

        container.appendChild(resultItem);
        if (index === 0) {
            setHoveredResult(resultItem, container);
        }
    });
}

export function createResultItem(key, value, options = {}) {
    const {
        metadata = '',
        displayValue = null
    } = options;

    const displayKey = String(key || '').startsWith('root.') ? String(key).substring(5) : String(key || '');

    const resultItem = document.createElement('div');
    resultItem.classList.add('result-item');
    resultItem.dataset.selectable = 'true';

    const keyDiv = document.createElement('div');
    keyDiv.classList.add('result-key');
    keyDiv.textContent = displayKey;
    keyDiv.title = displayKey;
    resultItem.appendChild(keyDiv);

    if (value !== undefined && value !== null && String(value) !== '') {
        const valueDiv = document.createElement('div');
        valueDiv.classList.add('result-value');
        const finalValue = displayValue === null ? String(value) : String(displayValue);
        valueDiv.textContent = finalValue;
        valueDiv.title = String(value);
        resultItem.appendChild(valueDiv);
    }

    if (metadata) {
        const metaDiv = document.createElement('div');
        metaDiv.classList.add('result-meta');
        metaDiv.textContent = metadata;
        resultItem.appendChild(metaDiv);
    }

    return resultItem;
}

export function createLoader(text = 'Loading data...') {
    const loader = document.createElement('div');
    loader.classList.add('loader');

    const spinner = document.createElement('span');
    spinner.className = 'loader-spinner';

    const label = document.createElement('span');
    label.textContent = text;

    loader.appendChild(spinner);
    loader.appendChild(label);

    return loader;
}

export function resultsSelection(resultsContainer, input) {
    function handleKeydown(event) {
        event.stopPropagation();
        const allItems = Array.from(resultsContainer.querySelectorAll('.result-item[data-selectable="true"]'));
        if (!allItems.length) return;

        const currentIndex = allItems.findIndex(item => item.classList.contains('hovered'));
        if (event.key === 'ArrowDown') {
            const nextIndex = (currentIndex + 1) % allItems.length;
            setHoveredResult(allItems[nextIndex], resultsContainer);
            event.preventDefault();
        } else if (event.key === 'ArrowUp') {
            const prevIndex = currentIndex === -1
                ? allItems.length - 1
                : (currentIndex - 1 + allItems.length) % allItems.length;
            setHoveredResult(allItems[prevIndex], resultsContainer);
            event.preventDefault();
        } else if (event.key === 'Enter') {
            const hoveredItem = currentIndex >= 0 ? allItems[currentIndex] : allItems[0];
            if (hoveredItem) hoveredItem.click();
            event.preventDefault();
        }
    }

    addUniqueEventListener(input, 'keydown', handleKeydown);
}

export function setHoveredResult(item, container) {
    if (!item) {
        return;
    }

    const currentHovered = container.querySelector('.result-item.hovered');
    if (currentHovered) {
        currentHovered.classList.remove('hovered');
    }
    item.classList.add('hovered');
}

export function flattenFields(fields, parentKey = '', result = []) {
    if (Array.isArray(fields)) {
        fields.forEach(item => {
            const keyPart = item && typeof item === 'object' ? String(item.key || '') : '';
            const newKey = parentKey ? `${parentKey}.${keyPart}` : keyPart;

            if (item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'value')) {
                if (Array.isArray(item.value)) {
                    flattenFields(item.value, newKey, result);
                } else if (item.value !== null && typeof item.value === 'object') {
                    const nestedFields = Object.keys(item.value).map(key => ({ key, value: item.value[key] }));
                    flattenFields(nestedFields, newKey, result);
                } else {
                    result.push({ key: newKey, value: item.value });
                }
                return;
            }

            flattenFields(item, parentKey, result);
        });
    } else if (fields && typeof fields === 'object') {
        Object.keys(fields).forEach(key => {
            const newKey = parentKey ? `${parentKey}.${key}` : key;
            flattenFields(fields[key], newKey, result);
        });
    } else if (parentKey) {
        result.push({ key: parentKey, value: fields });
    }

    return result;
}

export function calculateRelevance(query, target) {
    const normalizedQuery = normalizeString(query);
    const normalizedTarget = normalizeString(target);
    if (!normalizedQuery || !normalizedTarget) {
        return 0;
    }

    const substringScore = normalizedTarget.includes(normalizedQuery) ? 1 : 0;
    const queryTokens = normalizeTokens(normalizedQuery);
    const targetTokens = normalizeTokens(normalizedTarget);
    const matchedTokens = queryTokens.filter(token => targetTokens.includes(token));
    const tokenScore = queryTokens.length ? matchedTokens.length / queryTokens.length : 0;
    const reorderedMatch = queryTokens.every(token => targetTokens.includes(token)) ? 1 : 0;
    const concatenatedQuery = queryTokens.join('');
    const concatenatedTarget = targetTokens.join('');
    const concatenatedMatch = concatenatedTarget.includes(concatenatedQuery) ? 1 : 0;
    const levenshteinScore = concatenatedQuery.length
        ? 1 - (levenshteinDistance(concatenatedQuery, concatenatedTarget) / Math.max(concatenatedQuery.length, concatenatedTarget.length))
        : 0;

    return (2 * substringScore) + tokenScore + reorderedMatch + concatenatedMatch + (0.5 * levenshteinScore);
}
