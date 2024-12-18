document.addEventListener('keyup', handleKeyUp);

const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
        console.log(mutation);
        if (mutation.type === 'characterData' && mutation.target.data.slice(-2) === '//') {
            displayCompanySearchWidget(mutation.target.parentElement);
        }
    });
});

observer.observe(document.body, {childList: true, subtree: true, attributes: true, characterData: true});

let companies = [];

// Send a message to the background script
chrome.runtime.sendMessage(
    {action: "fetchCompanies"},
    (response) => {
        if (chrome.runtime.lastError) {
            console.error("Message Error:", chrome.runtime.lastError);
        } else if (response.success) {
            companies = response.companies;
            console.log("Fetched Companies:", companies);
        } else {
            console.error("Error fetching companies:", response.error);
        }
    }
);


function handleKeyUp(event) {
    const element = event.target;
    console.log(event);
    if (element.value.slice(-2) === '//') {
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
    if (isInputOrTextarea(element)) {
        element.autocomplete = 'off';
    }
    const widget = createWidget(element);
    const header = createHeader(widget);
    const backButton = createBackButton(widget, header);

    const searchInput = createSearchInput(widget);
    const resultsContainer = createResultsContainer(widget);

    chrome.storage.local.get('selectedCompany', function (data) {
        console.log(data);
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
    //createFooter(widget);


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

function createWidget(input) {
    const widget = document.createElement('div');
    widget.classList.add('grantzy-widget');

    const rect = input.getBoundingClientRect();
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
    widget.appendChild(resultsContainer);
    return resultsContainer;
}

function setupDataSearch(searchInput, resultsContainer, companyId, input) {
    searchInput.placeholder = 'Search data...';
    // Send message to background script to fetch company data
    chrome.runtime.sendMessage(
        {action: "fetchCompanyData", companyId: companyId},
        (response) => {
            if (chrome.runtime.lastError) {
                console.error("Message Error:", chrome.runtime.lastError);
            } else if (response.success) {
                const fields = flattenFields(response.data.fields);
                updateResultsContainer(resultsContainer, fields, input);
                firstResultAutoSelection(resultsContainer, input);
            } else {
                console.error("Error fetching company data:", response.error);
            }
        }
    );
    firstResultAutoSelection(resultsContainer, searchInput);

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

function firstResultAutoSelection(resultsContainer, input) {
    const firstResultItem = resultsContainer.querySelector('.result-item');
    if (firstResultItem) {
        setHoveredResult(firstResultItem);
    }

    input.addEventListener('keydown', function (event) {
        console.log(event.key);
        if (event.key === 'Enter') {
            const hoveredItem = resultsContainer.querySelector('.result-item.hovered');
            if (hoveredItem) {
                hoveredItem.click();
            }
        }

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const allItems = Array.from(resultsContainer.querySelectorAll('.result-item'));
            let currentIndex = allItems.findIndex(item => item.classList.contains('hovered'));
            if (currentIndex === -1) currentIndex = 0;

            if (event.key === 'ArrowDown') {
                const nextIndex = (currentIndex + 1) % allItems.length;
                setHoveredResult(allItems[nextIndex]);
            } else if (event.key === 'ArrowUp') {
                const prevIndex = (currentIndex - 1 + allItems.length) % allItems.length;
                setHoveredResult(allItems[prevIndex]);
            }
            event.preventDefault(); // Prevent cursor from moving inside the input
        }
    });
}

function setupCompanySearch(searchInput, resultsContainer, input) {
    searchInput.placeholder = 'Search company...';
    searchInput.addEventListener('input', function () {
        const query = searchInput.value.toLowerCase();
        const results = companies.filter(company => company.name.toLowerCase().includes(query));
        updateCompanyResults(resultsContainer, results, searchInput, input);
    });
    firstResultAutoSelection(resultsContainer, searchInput);
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
            //remove the hovered class from all the result items
            const hoveredItem = container.querySelector('.result-item.hovered');
            if (hoveredItem) {
                hoveredItem.classList.remove('hovered');
            }
            resultItem.classList.add('hovered');

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
    console.log(searchInput)
    searchInput.addEventListener('input', function () {
        const query = searchInput.value.toLowerCase();
        const results = data.filter(item => item.key.toLowerCase().includes(query));
        updateDataResults(container, results, input);
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

            const hoveredItem = container.querySelector('.result-item.hovered');
            if (hoveredItem) {
                hoveredItem.classList.remove('hovered');
            }
            resultItem.classList.add('hovered');
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