import {normalizeString, normalizeTokens, levenshteinDistance, addUniqueEventListener} from './utils.js';

let applications = [];

// Fetch applications when the module loads.
fetchApplications();

export function fetchApplications() {
    chrome.runtime.sendMessage({action: "fetchApplications"}, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Message Error:", chrome.runtime.lastError);
        } else if (response.success) {
            applications = response.applications;
        } else {
            console.error("Error fetching applications:", response.error);
        }
    });
}

export function setupApplicationSearch(searchInput, resultsContainer, targetElement, callback) {
    searchInput.placeholder = 'Search applications...';

    function applicationSearchListener() {
        const query = searchInput.value.toLowerCase().trim();
        const normalizedQuery = normalizeString(query);
        const rankedResults = applications
            .map(application => {
                // Calculate relevance for both title and company_name
                const titleRelevance = calculateRelevance(normalizedQuery, normalizeString(application.title));
                const companyRelevance = calculateRelevance(normalizedQuery, normalizeString(application.company_name));

                // Use the higher of the two relevance scores
                const relevance = Math.max(titleRelevance, companyRelevance);

                return {
                    application,
                    relevance
                };
            })
            .filter(result => result.relevance > 0.3)
            .sort((a, b) => b.relevance - a.relevance);
        const filteredResults = rankedResults.map(r => r.application);
        updateApplicationResults(resultsContainer, filteredResults, searchInput, targetElement);
        resultsSelection(resultsContainer, searchInput);
    }

    searchInput.addEventListener('input', applicationSearchListener);
    searchInput._applicationSearchListener = applicationSearchListener;
    if (callback) callback();
}

export function setupDataSearch(searchInput, resultsContainer, applicationId, targetElement, callback) {
    // Remove the application search listener if it exists.
    if (searchInput._applicationSearchListener) {
        searchInput.removeEventListener('input', searchInput._applicationSearchListener);
        delete searchInput._applicationSearchListener;
    }

    // Optionally, reset the flag to allow attaching a new data search listener.
    searchInput._dataSearchAttached = false;

    // Clear previous search context to ensure data search uses fresh fields.
    targetElement.searchContextData = null;

    searchInput.placeholder = 'Search data...';
    chrome.runtime.sendMessage({action: "fetchApplicationData", applicationId: applicationId}, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Message Error:", chrome.runtime.lastError);
            if (callback) callback();
        } else if (response.success) {
            console.log("Application data fetched:", response.data);
            chrome.storage.local.set({
                selectedApplicationData: {
                    fields: response.data.fields
                }
            });
            const fields = flattenFields(response.data.fields);
            updateResultsContainer(resultsContainer, fields, targetElement, searchInput);
            resultsSelection(resultsContainer, searchInput);
            if (callback) callback();
        } else {
            console.error("Error fetching application data:", response.error);
            if (callback) callback();
        }
    });
}

export function updateApplicationResults(container, results, searchInput, targetElement) {
    container.innerHTML = '';
    results.forEach((result, index) => {
        const resultItem = createResultItem(result.title, result.company_name);
        resultItem.addEventListener('click', function () {
            chrome.storage.local.set({
                selectedApplication: {
                    uuid: result.uuid,
                    title: result.title,
                    companyName: result.company_name
                }
            }, function () {
                const widget = container.parentElement;
                const header = widget.querySelector('.widget-header');
                const backButton = widget.querySelector('button');
                container.innerHTML = '';
                const loader = createLoader();
                searchInput.disabled = true;
                container.appendChild(loader);
                setupDataSearch(searchInput, container, result.uuid, targetElement, function () {
                    loader.remove();
                    header.textContent = `Application selected: ${result.title} | ${result.company_name}`;
                    backButton.style.display = 'block';
                    searchInput.disabled = false;
                    searchInput.value = '';
                    searchInput.focus();
                });
            });
        });
        resultItem.addEventListener('mouseover', function () {
            setHoveredResult(resultItem, container);
        });
        container.appendChild(resultItem);
        if (index === 0) {
            setHoveredResult(resultItem, container);
        }
    });
}


// Remove the event listener attachment from here and attach it only once.
export function updateResultsContainer(container, data, targetElement, searchInput) {
    container.innerHTML = '';
    // Attach the input listener only once.
    if (!searchInput._dataSearchAttached) {
        searchInput.addEventListener('input', function () {
            const query = searchInput.value.toLowerCase().trim();
            // If a specific search context is selected, use that; otherwise, use full data.
            const dataToSearch = targetElement.searchContextData
                ? flattenFields(targetElement.searchContextData)
                : data;
            if (!query) {
                // If empty, show full results.
                updateDataResults(container, dataToSearch, targetElement);
            } else {
                const normalizedQuery = normalizeString(query);
                const rankedResults = dataToSearch
                    .map(item => ({
                        item,
                        relevance: calculateRelevance(normalizedQuery, normalizeString(item.key))
                    }))
                    .filter(result => result.relevance > 0.3)
                    .sort((a, b) => b.relevance - a.relevance);
                const filteredResults = rankedResults.map(r => r.item);
                updateDataResults(container, filteredResults, targetElement);
            }
            // Also update the selection (if needed)
            resultsSelection(container, searchInput);
        });
        searchInput._dataSearchAttached = true;
    }
    // Initially display all results.
    updateDataResults(container, data, targetElement);
}

function showToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.textContent = message;
    // Updated inline styles for top center positioning
    toast.style.position = 'fixed';
    toast.style.top = '20px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    toast.style.color = '#fff';
    toast.style.padding = '10px 20px';
    toast.style.borderRadius = '5px';
    toast.style.zIndex = '3100';
    toast.style.opacity = '1';

    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.transition = 'opacity 0.5s ease';
        toast.style.opacity = '0';
        setTimeout(() => {
            toast.remove();
        }, 500);
    }, duration);
}

export function updateDataResults(container, results, targetElement) {
    container.innerHTML = '';
    results.forEach((result, index) => {
        const resultItem = createResultItem(result.key, result.value);
        /*resultItem.addEventListener('click', function () {
          if (targetElement.value !== undefined) {
            const value = targetElement.value;
            const lastIndex = value.lastIndexOf('//');
            if (lastIndex !== -1) {
              targetElement.value = value.substring(0, lastIndex) + result.value;
            }
            const evnt = new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertFromPaste'
            });
            targetElement.dispatchEvent(evnt);
          } else {
            const textContent = targetElement.textContent;
            const lastIndex = textContent.lastIndexOf('//');
            if (lastIndex !== -1) {
              targetElement.textContent = textContent.substring(0, lastIndex) + result.value;
            }
          }
          // Remove the widget by removing its container.
          container.parentElement.remove();
        });*/
        resultItem.addEventListener('click', function () {
            navigator.clipboard.writeText(result.value)
                .then(() => {
                    console.log("Copied to clipboard: " + result.value);
                    // Optionally, provide visual feedback or remove the widget.
                    //container.parentElement.remove();
                    showToast("Copied to clipboard!");

                })
                .catch(err => {
                    console.error("Failed to copy text: ", err);
                });
        });
        resultItem.addEventListener('mouseover', function () {
            setHoveredResult(resultItem, container);
        });
        container.appendChild(resultItem);
        if (index === 0) {
            setHoveredResult(resultItem, container);
        }
    });
}

export function createResultItem(key, value) {
    // Remove "root." from the beginning of the key, if present
    const displayKey = key.startsWith('root.') ? key.substring(5) : key;

    const resultItem = document.createElement('div');
    resultItem.classList.add('result-item');

    // Create a container for the key.
    const keyDiv = document.createElement('div');
    keyDiv.classList.add('result-key');
    keyDiv.textContent = displayKey;
    // Show full key on hover using a tooltip
    keyDiv.title = displayKey;
    resultItem.appendChild(keyDiv);

    if (value) {
        // Create a container for the value on a new line.
        const valueDiv = document.createElement('div');
        valueDiv.classList.add('result-value');
        valueDiv.textContent = value;
        resultItem.appendChild(valueDiv);
    }
    return resultItem;
}

export function createLoader() {
    const loader = document.createElement('div');
    loader.classList.add('loader');
    loader.textContent = 'Loading data...';
    return loader;
}

export function resultsSelection(resultsContainer, input) {
    function handleKeydown(event) {
        event.stopPropagation();
        const allItems = Array.from(resultsContainer.querySelectorAll('.result-item'));
        if (!allItems.length) return;
        let currentIndex = allItems.findIndex(item => item.classList.contains('hovered'));
        if (event.key === 'ArrowDown') {
            const nextIndex = (currentIndex + 1) % allItems.length;
            setHoveredResult(allItems[nextIndex], resultsContainer);
            event.preventDefault();
        } else if (event.key === 'ArrowUp') {
            const prevIndex = currentIndex === -1 ? allItems.length - 1 : (currentIndex - 1 + allItems.length) % allItems.length;
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
    const currentHovered = container.querySelector('.result-item.hovered');
    if (currentHovered) {
        currentHovered.classList.remove('hovered');
    }
    item.classList.add('hovered');
}

export function flattenFields(fields, parentKey = '', result = []) {
    if (Array.isArray(fields)) {
        fields.forEach(item => {
            // Build the full key path by appending the current key
            const newKey = parentKey ? `${parentKey}.${item.key}` : item.key;
            if (Array.isArray(item.value)) {
                // If the value is an array, recurse to flatten its items.
                flattenFields(item.value, newKey, result);
            } else if (item.value !== null && typeof item.value === 'object') {
                // If the value is a plain object, convert it to an array of key/value pairs and then flatten.
                const nestedFields = Object.keys(item.value).map(key => ({key, value: item.value[key]}));
                flattenFields(nestedFields, newKey, result);
            } else {
                // Otherwise, push the current key/value pair.
                result.push({key: newKey, value: item.value});
            }
        });
    } else if (fields && typeof fields === 'object') {
        // Fallback in case fields is a plain object.
        Object.keys(fields).forEach(key => {
            const newKey = parentKey ? `${parentKey}.${key}` : key;
            flattenFields(fields[key], newKey, result);
        });
    } else {
        result.push({key: parentKey, value: fields});
    }
    return result;
}

export function calculateRelevance(query, target) {
    query = query.toLowerCase().trim();
    target = target.toLowerCase().trim();
    const substringScore = target.includes(query) ? 1 : 0;
    const queryTokens = normalizeTokens(query);
    const targetTokens = normalizeTokens(target);
    const matchedTokens = queryTokens.filter(token => targetTokens.includes(token));
    const tokenScore = queryTokens.length ? matchedTokens.length / queryTokens.length : 0;
    const reorderedMatch = queryTokens.every(token => targetTokens.includes(token)) ? 1 : 0;
    const concatenatedQuery = queryTokens.join('');
    const concatenatedTarget = targetTokens.join('');
    const concatenatedMatch = concatenatedTarget.includes(concatenatedQuery) ? 1 : 0;
    const levenshteinScore = concatenatedQuery.length
        ? 1 - levenshteinDistance(concatenatedQuery, concatenatedTarget) / Math.max(concatenatedQuery.length, concatenatedTarget.length)
        : 0;
    return (2 * substringScore) + (1 * tokenScore) + (1 * reorderedMatch) + (1 * concatenatedMatch) + (0.5 * levenshteinScore);
}