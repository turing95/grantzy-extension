document.addEventListener('keyup', handleKeyUp);


const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
        //check if mutation type is character data and if the data ends with '//'
        if (mutation.type === 'characterData' && mutation.target.data.slice(-2) === '//') {
            displayCompanySearchWidget(mutation.target.parentElement);
        }
    });
});

observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });

let companies = [];
fetch('http://localhost:8000/api/companies/')
    .then(response => response.json())
    .then(data => {
        companies = data;
    })
    .catch(error => console.error('Error fetching companies:', error));


function handleKeyUp(event) {
    const input = event.target;
    if (isInputOrTextarea(input) && input.value.slice(-2) === '//') {
        displayCompanySearchWidget(input);
    }
}

function isInputOrTextarea(element) {
    const tagName = element.tagName.toLowerCase();
    return tagName === 'input' || tagName === 'textarea';
}

function displayCompanySearchWidget(element) {
    if(isInputOrTextarea(element)) {
        element.autocomplete = 'off';
    }
    const widget = createWidget(element);
    const header = createHeader(widget);
    const backButton = createBackButton(widget,header);

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

    document.body.appendChild(widget);
    document.addEventListener('click', (event) => handleClickOutside(event, widget));
}

function createBackButton(widget,header) {
    const backButton = document.createElement('button');
    backButton.textContent = 'Select another company';
    backButton.style.display = 'none';
    backButton.addEventListener('click', function () {
        chrome.storage.local.remove('selectedCompany', function () {
            const searchInput = widget.querySelector('input[type="text"]');
            const resultsContainer = widget.querySelector('div');
            backButton.style.display = 'none';
            header.textContent = 'Select a company';
            setupCompanySearch(searchInput, resultsContainer, searchInput);
        });
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
    widget.appendChild(resultsContainer);
    return resultsContainer;
}

function setupDataSearch(searchInput, resultsContainer, companyId, input) {
    searchInput.placeholder = 'Search data...';
    fetch(`http://localhost:8000/api/companies/${companyId}`)
        .then(response => response.json())
        .then(data => {
            //const fields = Object.keys(data.fields).map(key => ({ key, value: data.fields[key] }));
            const fields = flattenFields(data.fields);
            updateResultsContainer(resultsContainer, fields, input);
        })
        .catch(error => console.error('Error fetching company data:', error));
}

function flattenFields(fields, parentKey = '', result = []) {
    for (const key in fields) {
        const newKey = parentKey ? `${parentKey}.${key}` : key;
        if (typeof fields[key] === 'object' && fields[key] !== null) {
            flattenFields(fields[key], newKey, result);
        } else {
            result.push({ key: newKey, value: fields[key] });
        }
    }
    return result;
}

function setupCompanySearch(searchInput, resultsContainer, input) {
    searchInput.placeholder = 'Search company...';
    searchInput.addEventListener('input', function () {
        const query = searchInput.value.toLowerCase();
        const results = companies.filter(company => company.name.toLowerCase().includes(query));
        updateCompanyResults(resultsContainer, results, searchInput, input);
    });
}

function updateCompanyResults(container, results, searchInput, input) {
    container.innerHTML = '';
    results.forEach(result => {
        const resultItem = createResultItem(result.name);
        resultItem.addEventListener('click', function () {
            chrome.storage.local.set({selectedCompany: {uuid: result.uuid, name: result.name}}, function () {
                const widget = container.parentElement;
                const header = widget.querySelector('.widget-header');
                const backButton = widget.querySelector('button');
                header.textContent = `Company selected: ${result.name}`
                backButton.style.display = 'block';
                setupDataSearch(searchInput, container, result.uuid, input);
            });
        });
        container.appendChild(resultItem);
    });
}

function createResultItem(text) {
    const resultItem = document.createElement('div');
    resultItem.textContent = text;
    resultItem.classList.add('result-item');
    return resultItem;
}

function updateResultsContainer(container, data, input) {
    container.innerHTML = '';
    const searchInput = container.previousSibling;
    searchInput.addEventListener('input', function () {
        const query = searchInput.value.toLowerCase();
        const results = data.filter(item => item.key.toLowerCase().includes(query));
        updateDataResults(container, results, input);
    });
}

function updateDataResults(container, results, element) {
    container.innerHTML = '';
    results.forEach(result => {
        const resultItem = createResultItem(result.key);
        resultItem.addEventListener('click', function () {
            if (isInputOrTextarea(element)) {
                element.value = result.value;
            } else {
                element.textContent = result.value;
            }
            container.parentElement.remove();
            document.removeEventListener('click', handleClickOutside);
        });
        container.appendChild(resultItem);
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