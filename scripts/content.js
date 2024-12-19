document.addEventListener('keyup', handleKeyUp);

const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
            // Add listeners to all added nodes
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    attachListenersToAllElements(node);
                }
            });
        } else if (mutation.type === 'characterData' && mutation.target.data.slice(-2) === '//') {
            console.log(mutation);
            displayCompanySearchWidget(mutation.target.parentElement);
        }
    });
});

observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
});

// Attach listener to all elements
function attachListenersToAllElements(element) {
    addKeyUpListener(element);

    // Recursively add listeners to all child nodes
    element.querySelectorAll('*').forEach(child => {
        addKeyUpListener(child);
    });
}

// Add the keyup listener
function addKeyUpListener(element) {
    if (!element._hasKeyUpListener) { // Prevent duplicate listeners
        element.addEventListener('keyup', handleKeyUp);
        element._hasKeyUpListener = true; // Custom property to mark as processed
    }
}

let companies = [];

// Send a message to the background script
chrome.runtime.sendMessage(
    {action: "fetchCompanies"},
    (response) => {
        if (chrome.runtime.lastError) {
            console.error("Message Error:", chrome.runtime.lastError);
        } else if (response.success) {
            companies = response.companies;
        } else {
            console.error("Error fetching companies:", response.error);
        }
    }
);


function handleKeyUp(event) {
    const element = event.target;
    if (element.value && element.value.slice(-2) === '//') {
        displayCompanySearchWidget(element);
    }
}

function isInputOrTextarea(element) {
    const tagName = element.tagName.toLowerCase();
    return tagName === 'input' || tagName === 'textarea';
}

function createFooter(widget) {
    const footer = document.createElement('div');
    footer.classList.add('grantzy-widget-footer');

    const logo = document.createElement('img');
    logo.src = chrome.runtime.getURL("img/logo.svg");
    logo.alt = 'Logo';
    logo.classList.add('grantzy-widget-logo');

    footer.appendChild(logo);
    widget.appendChild(footer);

}


function displayCompanySearchWidget(element) {
    if (document.querySelector('.grantzy-widget')) {
        return;
    }
        console.log(element);
        console.log(document.activeElement);

    // Check if the element is an input or textarea and if it is currently focused
    if (!isInputOrTextarea(element) && document.activeElement !== element) {
        return;
    }

    console.log(element);

    if (isInputOrTextarea(element)) {
        element.autocomplete = 'off';
    }

    const widget = createWidget(element);
    const header = createHeader(widget);
    const backButton = createBackButton(widget, header);

    const searchInput = createSearchInput(widget);
    const resultsContainer = createResultsContainer(widget);

    chrome.storage.local.get('selectedCompany', function (data) {
        if (data.selectedCompany) {
            header.textContent = `Company selected: ${data.selectedCompany.name}`;
            backButton.style.display = 'block';
            setupDataSearch(searchInput, resultsContainer, data.selectedCompany.uuid, element);
        } else {
            header.textContent = 'Select a company';
            backButton.style.display = 'none';
            setupCompanySearch(searchInput, resultsContainer, element);
        }
    });

    document.body.appendChild(widget);
    searchInput.focus();
    document.addEventListener('click', (event) => handleClickOutside(event, widget));
}

function createBackButton(widget, header) {
    const backButton = document.createElement('button');
    backButton.textContent = 'Select another company';
    backButton.style.display = 'none';
    backButton.addEventListener('click', function () {
        const searchInput = widget.querySelector('input[type="text"]');
        chrome.storage.local.remove('selectedCompany', function () {
            const resultsContainer = widget.querySelector('.results-container');
            resultsContainer.innerHTML = '';
            backButton.style.display = 'none';
            header.textContent = 'Select a company';
            setupCompanySearch(searchInput, resultsContainer, searchInput);
        });
        searchInput.value = '';
        searchInput.focus();
    });
    widget.appendChild(backButton);
    return backButton;
}

function createWidget(element) {
    const widget = document.createElement('div');
    widget.classList.add('grantzy-widget');

    const rect = element.getBoundingClientRect();
    widget.style.top = `${rect.bottom + window.scrollY}px`;
    widget.style.left = `${rect.left + window.scrollX}px`;

    return widget;
}


function createSearchInput(widget) {
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    widget.appendChild(searchInput);
    return searchInput;
}

function createResultsContainer(widget) {
    const resultsContainer = document.createElement('div');
    resultsContainer.classList.add('results-container');

    // Set a fixed height and make it scrollable
    resultsContainer.style.maxHeight = '300px'; // Adjust the height as needed
    resultsContainer.style.overflowY = 'auto';  // Allow vertical scrolling if the content exceeds the max height

    widget.appendChild(resultsContainer);
    return resultsContainer;
}

function setupDataSearch(searchInput, resultsContainer, companyId, input) {
    searchInput.placeholder = 'Search data...';
    chrome.runtime.sendMessage(
        {action: "fetchCompanyData", companyId: companyId},
        (response) => {
            if (chrome.runtime.lastError) {
                console.error("Message Error:", chrome.runtime.lastError);
            } else if (response.success) {
                const fields = flattenFields(response.data.fields);
                updateResultsContainer(resultsContainer, fields, input);
                resultsSelection(resultsContainer, searchInput);
            } else {
                console.error("Error fetching company data:", response.error);
            }
        }
    );

}

function flattenFields(fields, parentKey = '', result = []) {
    for (const key in fields) {
        const newKey = parentKey ? `${parentKey}.${key}` : key;
        if (typeof fields[key] === 'object' && fields[key] !== null) {
            flattenFields(fields[key], newKey, result);
        } else {
            result.push({key: newKey, value: fields[key]});
        }
    }
    return result;
}

function setHoveredResult(item) {
    const currentHovered = item.parentElement.querySelector('.result-item.hovered');
    if (currentHovered) {
        currentHovered.classList.remove('hovered');
    }
    item.classList.add('hovered');
}

function addUniqueEventListener(element, event, listener) {
    // Initialize a custom tracking set if it doesn't exist
    if (!element._eventListeners) {
        element._eventListeners = new Set();
    }

    const listenerKey = `${event}-${listener.toString()}`;

    // Add listener only if it's not already added
    if (!element._eventListeners.has(listenerKey)) {
        element.addEventListener(event, listener);
        element._eventListeners.add(listenerKey);
    }
}

function resultsSelection(resultsContainer, input) {

    function handleKeydown(event) {
        event.stopPropagation();
        const allItems = Array.from(resultsContainer.querySelectorAll('.result-item'));
        console.log(allItems);
        if (!allItems.length) return;

        let currentIndex = allItems.findIndex(item => item.classList.contains('hovered'));
        if (event.key === 'ArrowDown') {
            const nextIndex = (currentIndex + 1) % allItems.length;
            setHoveredResult(allItems[nextIndex]);
            event.preventDefault();
        } else if (event.key === 'ArrowUp') {
            const prevIndex = currentIndex === -1 ? allItems.length - 1 : (currentIndex - 1 + allItems.length) % allItems.length;
            setHoveredResult(allItems[prevIndex]);
            event.preventDefault();
        } else if (event.key === 'Enter') {
            const hoveredItem = currentIndex >= 0 ? allItems[currentIndex] : allItems[0];
            if (hoveredItem) hoveredItem.click();
            event.preventDefault();
        }
    }

    addUniqueEventListener(input, 'keydown', handleKeydown);
}

function calculateRelevance(query, target) {
    query = query.toLowerCase().trim();
    target = target.toLowerCase().trim();

    // Tokenize both query and target
    const queryTokens = normalizeTokens(query);
    const targetTokens = normalizeTokens(target);

    // Exact Substring Match (for full query match)
    const substringScore = target.includes(query) ? 1 : 0;

    // Token Matching (ignoring order)
    const matchedTokens = queryTokens.filter(token => targetTokens.includes(token));
    const tokenScore = matchedTokens.length / queryTokens.length; // Matching tokens based on query length

    // Token Reordering Match
    const reorderedMatch = queryTokens.every(token => targetTokens.includes(token)) ? 1 : 0;

    // Concatenated Token Match
    const concatenatedQuery = queryTokens.join('');
    const concatenatedTarget = targetTokens.join('');
    const concatenatedMatch = concatenatedTarget.includes(concatenatedQuery) ? 1 : 0;

    // Levenshtein Distance for fuzzy comparison (accounting for typos)
    const levenshteinScore = 1 - levenshteinDistance(concatenatedQuery, concatenatedTarget) / Math.max(concatenatedQuery.length, concatenatedTarget.length);

    // Combine scores with weights
    return (
        2 * substringScore + // Prioritize exact matches (for full query match)
        1 * tokenScore +      // Reward partial matches for token overlaps
        1 * reorderedMatch +  // Reward token reordering matches
        1 * concatenatedMatch + // Reward concatenated token matches
        0.5 * levenshteinScore // Account for minor typos using Levenshtein distance
    );
}

// Levenshtein distance function
function levenshteinDistance(a, b) {
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    const matrix = Array.from({length: b.length + 1}, (_, i) => [i]);

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b[i - 1] === a[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // Substitution
                    matrix[i][j - 1] + 1,     // Insertion
                    matrix[i - 1][j] + 1      // Deletion
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

// Tokenize the string by normalizing and splitting by spaces
function normalizeTokens(str) {
    return normalizeString(str).split(/\s+/);
}

// Normalize string by removing spaces, periods, and underscores
function normalizeString(str) {
    return str.replace(/[\s._]+/g, '').toLowerCase();
}

function setupCompanySearch(searchInput, resultsContainer, input) {
    searchInput.placeholder = 'Search company...';
    searchInput.addEventListener('input', function () {
        const query = searchInput.value.toLowerCase().trim();
        console.log("Query Entered:", query);

        // Normalize the query for better matching
        const normalizedQuery = normalizeString(query);
        const rankedResults = companies
            .map(company => ({
                company,
                relevance: calculateRelevance(normalizedQuery, normalizeString(company.name)),
            }))
            .filter(result => result.relevance > 0.3) // Filter out low-relevance matches
            .sort((a, b) => b.relevance - a.relevance); // Sort by relevance descending

        console.log("Ranked Results:", rankedResults);

        // Update UI with ranked results
        const filteredResults = rankedResults.map(r => r.company);
        updateCompanyResults(resultsContainer, filteredResults, searchInput, input);
        resultsSelection(resultsContainer, searchInput);
    });
}

function updateCompanyResults(container, results, searchInput, input) {
    container.innerHTML = '';
    results.forEach((result, index) => {
        const resultItem = createResultItem(result.name);

        resultItem.addEventListener('click', function () {
            chrome.storage.local.set({selectedCompany: {uuid: result.uuid, name: result.name}}, function () {
                const widget = container.parentElement;
                const header = widget.querySelector('.widget-header');
                const backButton = widget.querySelector('button');
                header.textContent = `Company selected: ${result.name}`
                backButton.style.display = 'block';
                setupDataSearch(searchInput, container, result.uuid, input);
                searchInput.value = '';
                searchInput.focus();
            });
        });
        resultItem.addEventListener('mouseover', function () {
            setHoveredResult(resultItem);

        });
        container.appendChild(resultItem);
        if (index === 0) {
            setHoveredResult(resultItem);
        }
    });
}

function createResultItem(key, value) {
    const resultItem = document.createElement('div');
    resultItem.classList.add('result-item');

    const keySpan = document.createElement('span');
    keySpan.textContent = key;
    resultItem.appendChild(keySpan);
    if (value) {
        const valueSpan = document.createElement('span');
        valueSpan.textContent = value.length > 20 ? value.substring(0, 20) + '...' : value;
        valueSpan.style.float = 'right';
        resultItem.appendChild(valueSpan);
    }


    return resultItem;
}

function updateResultsContainer(container, data, input) {
    container.innerHTML = '';
    const searchInput = container.previousSibling;
    searchInput.addEventListener('input', function () {
        const query = searchInput.value.toLowerCase().trim();
        if (!query) {
            container.innerHTML = ''; // Clear results if query is empty
            return;
        }

        // Normalize the query for better matching
        const normalizedQuery = normalizeString(query);

        // Rank and filter results using fuzzy matching
        const rankedResults = data
            .map(item => ({
                item,
                relevance: calculateRelevance(normalizedQuery, normalizeString(item.key)), // Using normalized keys
            }))
            .filter(result => result.relevance > 0.3) // Filter out low-relevance results
            .sort((a, b) => b.relevance - a.relevance); // Sort by relevance

        const filteredResults = rankedResults.map(r => r.item);
        updateDataResults(container, filteredResults, input);
        resultsSelection(container, searchInput);
    });
}

function updateDataResults(container, results, element) {
    container.innerHTML = '';
    results.forEach((result, index) => {
        const resultItem = createResultItem(result.key, result.value);

        resultItem.addEventListener('click', function () {
            if (isInputOrTextarea(element)) {
                const value = element.value;
                const lastIndex = value.lastIndexOf('//');
                if (lastIndex !== -1) {
                    element.value = value.substring(0, lastIndex) + result.value;
                }
                let evnt = new InputEvent('input', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'insertFromPaste'
                });
                element.dispatchEvent(evnt);
            } else {
                const textContent = element.textContent;
                const lastIndex = textContent.lastIndexOf('//');
                if (lastIndex !== -1) {
                    element.textContent = textContent.substring(0, lastIndex) + result.value;
                }
            }
            container.parentElement.remove();
            document.removeEventListener('click', handleClickOutside);
        });
        resultItem.addEventListener('mouseover', function () {
            setHoveredResult(resultItem);
        });
        container.appendChild(resultItem);
        if (index === 0) {
            setHoveredResult(resultItem);
        }
    });
}

function handleClickOutside(event, widget) {
    if (!widget.contains(event.target)) {
        widget.remove();
        document.removeEventListener('click', handleClickOutside);
    }
}


function createHeader(widget) {
    const header = document.createElement('div');
    header.classList.add('widget-header');
    widget.appendChild(header);
    return header;
}