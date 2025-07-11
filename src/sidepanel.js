import {
    setupApplicationSearch,
    setupDataSearch,
    flattenFields,
    updateDataResults,
    resultsSelection
} from './searchHandler.js';

const searchInput = document.getElementById('app-search-input');
const resultsContainer = document.getElementById('app-search-results');
const widgetEl = document.getElementById('grantzy-sidepanel');
const containerEl = widgetEl.querySelector('.widget-container');
const headerEl = widgetEl.querySelector('.widget-header');
const backButton = document.getElementById('back-button');
let sidebarEl = null;
let selectedTreeNodeElement = null;
let selectedTreeNodeData = null;
function renderTree(data) {
    const ul = document.createElement('ul');
    if (Array.isArray(data)) {
        data.forEach(item => {
            // Check if item.value exists and is an object with children.
            let childData = item.value;
            let hasChildren = false;
            if (childData && typeof childData === 'object') {
                if (Array.isArray(childData)) {
                    hasChildren = childData.length > 0;
                } else {
                    hasChildren = Object.keys(childData).length > 0;
                }
            }
            // Only render nodes that have children (i.e. non-leaf nodes)
            if (!hasChildren) {
                return; // skip this leaf node
            }

            const li = document.createElement('li');
            li.textContent = item.key;
            li.style.cursor = 'pointer';
            li.dataset.expanded = "false";
            li.addEventListener('click', (e) => {
                e.stopPropagation();
                // Collapse siblings if needed.
                Array.from(li.parentElement.children).forEach(sibling => {
                    if (sibling !== li && sibling.dataset.expanded === "true") {
                        const childUl = sibling.querySelector('ul');
                        if (childUl) sibling.removeChild(childUl);
                        sibling.dataset.expanded = "false";
                        sibling.classList.remove('selected');
                    }
                });
                if (li.dataset.expanded === "false") {
                    // Only render children if they exist (we already checked above)
                    if (childData && typeof childData === 'object') {
                        // If childData is not already an array, convert it.
                        if (!Array.isArray(childData)) {
                            childData = Object.keys(childData).map(key => ({key, value: childData[key]}));
                        }
                        const childUl = renderTree(childData);
                        li.appendChild(childUl);
                    }
                    li.dataset.expanded = "true";
                    setSelectedTreeNode(item.value, li);
                } else {
                    const childUl = li.querySelector('ul');
                    if (childUl) li.removeChild(childUl);
                    li.dataset.expanded = "false";
                    if (selectedTreeNodeElement === li) {
                        clearSelectedTreeNode();
                    }
                }
            });
            ul.appendChild(li);
        });
    } else if (data && typeof data === 'object') {
        // Fallback for non-array data: render only keys that are objects with children.
        Object.keys(data).forEach(key => {
            let value = data[key];
            if (!value || typeof value !== 'object' || Object.keys(value).length === 0) {
                return; // skip leaf nodes
            }
            const li = document.createElement('li');
            li.textContent = key;
            li.style.cursor = 'pointer';
            li.dataset.expanded = "false";
            li.addEventListener('click', (e) => {
                e.stopPropagation();
                // Similar expand/collapse logic can be added here if needed.
            });
            ul.appendChild(li);
        });
    }
    return ul;
}

function setSelectedTreeNode(data, liElement) {
    selectedTreeNodeData = data;
    if (selectedTreeNodeElement && selectedTreeNodeElement !== liElement) {
        selectedTreeNodeElement.classList.remove('selected');
    }
    liElement.classList.add('selected');
    selectedTreeNodeElement = liElement;
    //targetElement.searchContextData = data;
    triggerSearchForSelectedNode();
    highlightSelectedRootNode();
}
function highlightSelectedRootNode() {
        // Traverse up from the selected node until reaching a direct child of the sidebar.
        if (selectedTreeNodeElement) {
            let current = selectedTreeNodeElement;
            // Loop until the parent's parent is the sidebar container.
            while (current.parentElement && !current.parentElement.classList.contains('widget-sidebar')) {
                if (current.parentElement.tagName.toLowerCase() === 'li') {
                    current = current.parentElement;
                } else {
                    break;
                }
            }
            // Remove the selected-root class from all top-level nodes
            if (sidebarEl) {
                const rootNodes = sidebarEl.querySelectorAll('li');
                rootNodes.forEach(node => node.classList.remove('selected-root'));
            }
            // Add the highlight class to the root node.
            current.classList.add('selected-root');
        }
    }
function clearSelectedTreeNode() {
    if (selectedTreeNodeElement) {
        selectedTreeNodeElement.classList.remove('selected');
        selectedTreeNodeElement = null;
    }
    selectedTreeNodeData = null;
    //targetElement.searchContextData = null;
}

function triggerSearchForSelectedNode() {
    if (!selectedTreeNodeData) return;
    const flattened = flattenFields(selectedTreeNodeData);
    updateDataResults(resultsContainer, flattened);
    resultsSelection(resultsContainer, searchInput);
}

function updateSidebar(selectedApplication) {
    if (selectedApplication) {
        if (!sidebarEl) {
            sidebarEl = document.createElement('div');
            sidebarEl.classList.add('widget-sidebar');
            containerEl.insertBefore(sidebarEl, resultsContainer);
        }
        sidebarEl.innerHTML = '';
        chrome.storage.local.get('selectedApplicationData', data => {
            if (data.selectedApplicationData && data.selectedApplicationData.fields) {
                const tree = renderTree(data.selectedApplicationData.fields);
                sidebarEl.appendChild(tree);
            } else {
                const p = document.createElement('p');
                p.textContent = 'No data available';
                sidebarEl.appendChild(p);
            }
        });
        headerEl.textContent = `Application: ${selectedApplication.title}`;
        backButton.style.display = 'block';
    } else {
        if (sidebarEl) {
            sidebarEl.remove();
            sidebarEl = null;
        }
        headerEl.textContent = 'Grantzy Applications';
        backButton.style.display = 'none';
    }
}

// initialize search
setupApplicationSearch(searchInput, resultsContainer, widgetEl);

backButton.addEventListener('click', () => {
    chrome.storage.local.remove(['selectedApplication', 'selectedApplicationData'], () => {
        updateSidebar(null);
        resultsContainer.innerHTML = '';
        searchInput.disabled = false;
        searchInput.value = '';
        setupApplicationSearch(searchInput, resultsContainer, widgetEl);
    });
});

// listen to storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes.selectedApplication) {
            updateSidebar(changes.selectedApplication.newValue);
        }
        if (changes.selectedApplicationData) {
            chrome.storage.local.get('selectedApplication', data => {
                updateSidebar(data.selectedApplication);
            });
        }
    }
});

// initial sidebar state
chrome.storage.local.get('selectedApplication', data => {
    updateSidebar(data.selectedApplication);
});