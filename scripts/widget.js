import {isInputOrTextarea} from './utils.js';
import {
    setupApplicationSearch,
    setupDataSearch,
    flattenFields,
    updateDataResults,
    resultsSelection
} from './searchHandler.js';
// For example, in widget.js
import widgetCss from '../styles/content.css';


export class ApplicationWidget {
    constructor(targetElement) {
        this.targetElement = targetElement;
        this.host = null;       // Host element for shadow DOM.
        this.widget = null;
        this.container = null;  // Flex container for sidebar and main content.
        this.sidebar = null;
        this.mainContent = null;
        this.header = null;
        this.searchInput = null;
        this.resultsContainer = null;
        this.backButton = null;
        // For search context:
        this.selectedTreeNodeData = null;
        this.selectedTreeNodeElement = null;
        // Used to delay sidebar restoration.
        this.expandTimeout = null;
        // Reference to our global click handler.
        this._globalClickHandler = null;
    }

    async createWidget() {
        // Create a host element for the shadow DOM and mark it.
        const host = document.createElement('div');
        host.setAttribute('data-widget-host', 'true');
        this.host = host;
        // Attach an open shadow root.
        const shadow = host.attachShadow({mode: 'open'});

        const sheet = new CSSStyleSheet();
        sheet.replaceSync(widgetCss);
        shadow.adoptedStyleSheets = [sheet];
        // Create the widget container element.
        const widget = document.createElement('div');
        widget.classList.add('grantzy-widget');
        widget.style.position = 'fixed';
        widget.style.visibility = 'hidden';
        shadow.appendChild(widget);

        // Append the host element to the document.
        document.body.appendChild(host);

        // Save reference to the widget and position it.
        this.widget = widget;
        this.positionWidget();

        // Create control buttons (an X button for removal).
        this.createControlButtons();

        // Create container for sidebar and main content.
        const container = document.createElement('div');
        container.classList.add('widget-container');
        widget.appendChild(container);
        this.container = container;

        // Set up mouse events for expanding the sidebar.
        widget.addEventListener('mouseover', () => {
            clearTimeout(this.expandTimeout);
            this.expandTimeout = setTimeout(() => {
                this.expandSidebar();
            }, 500);
        });
        widget.addEventListener('mouseout', () => {
            clearTimeout(this.expandTimeout);
        });

        // Reposition widget when its content changes.
        const observer = new MutationObserver(() => this.positionWidget());
        observer.observe(widget, {childList: true, subtree: true});

        // Show widget.
        requestAnimationFrame(() => {
            this.positionWidget();
            widget.style.visibility = 'visible';
        });

        // Attach the global click-outside listener.
        this.attachClickOutsideListener();

        return widget;
    }

    positionWidget() {
        if (!this.widget) return;
        const spacing = 20;
        this.widget.style.top = `${spacing}px`;
        this.widget.style.right = `${spacing}px`;
        this.widget.style.left = 'auto';
    }

    createControlButtons() {
        const controls = document.createElement('div');
        controls.classList.add('widget-controls');

        // Create an X button that completely removes the widget.
        const closeBtn = document.createElement('button');
        closeBtn.classList.add('widget-close-btn');
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.destroy();
        });

        controls.appendChild(closeBtn);
        this.widget.appendChild(controls);
    }

    createMainContentContainer() {
        const mainContent = document.createElement('div');
        mainContent.classList.add('widget-main');
        this.container.appendChild(mainContent);
        this.mainContent = mainContent;
        return mainContent;
    }

    renderTree(data) {
        const ul = document.createElement('ul');
        if (Array.isArray(data)) {
            data.forEach((item, index) => {
                if (typeof item === 'object' && item !== null) {
                    const li = document.createElement('li');
                    li.textContent = `[${index}]`;
                    li.style.cursor = 'pointer';
                    li.dataset.expanded = "false";
                    li.addEventListener('click', (e) => {
                        e.stopPropagation();
                        Array.from(li.parentElement.children).forEach(sibling => {
                            if (sibling !== li && sibling.dataset.expanded === "true") {
                                const childUl = sibling.querySelector('ul');
                                if (childUl) sibling.removeChild(childUl);
                                sibling.dataset.expanded = "false";
                                sibling.classList.remove('selected');
                            }
                        });
                        if (li.dataset.expanded === "false") {
                            const childUl = this.renderTree(item);
                            li.appendChild(childUl);
                            li.dataset.expanded = "true";
                            this.setSelectedTreeNode(item, li);
                        } else {
                            const childUl = li.querySelector('ul');
                            if (childUl) li.removeChild(childUl);
                            li.dataset.expanded = "false";
                            if (this.selectedTreeNodeElement === li) {
                                this.clearSelectedTreeNode();
                            }
                        }
                    });
                    ul.appendChild(li);
                }
            });
        } else {
            for (const key in data) {
                if (data.hasOwnProperty(key) && typeof data[key] === 'object' && data[key] !== null) {
                    const li = document.createElement('li');
                    li.textContent = key;
                    li.style.cursor = 'pointer';
                    li.dataset.expanded = "false";
                    li.addEventListener('click', (e) => {
                        e.stopPropagation();
                        Array.from(li.parentElement.children).forEach(sibling => {
                            if (sibling !== li && sibling.dataset.expanded === "true") {
                                const childUl = sibling.querySelector('ul');
                                if (childUl) sibling.removeChild(childUl);
                                sibling.dataset.expanded = "false";
                                sibling.classList.remove('selected');
                            }
                        });
                        if (li.dataset.expanded === "false") {
                            const childUl = this.renderTree(data[key]);
                            li.appendChild(childUl);
                            li.dataset.expanded = "true";
                            this.setSelectedTreeNode(data[key], li);
                        } else {
                            const childUl = li.querySelector('ul');
                            if (childUl) li.removeChild(childUl);
                            li.dataset.expanded = "false";
                            if (this.selectedTreeNodeElement === li) {
                                this.clearSelectedTreeNode();
                            }
                        }
                    });
                    ul.appendChild(li);
                }
            }
        }
        return ul;
    }

    setSelectedTreeNode(data, liElement) {
        this.selectedTreeNodeData = data;
        if (this.selectedTreeNodeElement && this.selectedTreeNodeElement !== liElement) {
            this.selectedTreeNodeElement.classList.remove('selected');
        }
        liElement.classList.add('selected');
        this.selectedTreeNodeElement = liElement;
        this.targetElement.searchContextData = data;
        this.triggerSearchForSelectedNode();
        this.highlightSelectedRootNode();
    }

    highlightSelectedRootNode() {
        // Traverse up from the selected node until reaching a direct child of the sidebar.
        if (this.selectedTreeNodeElement) {
            let current = this.selectedTreeNodeElement;
            // Loop until the parent's parent is the sidebar container.
            while (current.parentElement && !current.parentElement.classList.contains('widget-sidebar')) {
                if (current.parentElement.tagName.toLowerCase() === 'li') {
                    current = current.parentElement;
                } else {
                    break;
                }
            }
            // Remove the selected-root class from all top-level nodes
            if (this.sidebar) {
                const rootNodes = this.sidebar.querySelectorAll('li');
                rootNodes.forEach(node => node.classList.remove('selected-root'));
            }
            // Add the highlight class to the root node.
            current.classList.add('selected-root');
        }
    }

    clearSelectedTreeNode() {
        if (this.selectedTreeNodeElement) {
            this.selectedTreeNodeElement.classList.remove('selected');
            this.selectedTreeNodeElement = null;
        }
        this.selectedTreeNodeData = null;
        this.targetElement.searchContextData = null;
    }

    triggerSearchForSelectedNode() {
        if (!this.selectedTreeNodeData) return;
        const flattened = flattenFields(this.selectedTreeNodeData);
        updateDataResults(this.resultsContainer, flattened, this.targetElement);
        resultsSelection(this.resultsContainer, this.searchInput);
    }

    createHeader() {
        const header = document.createElement('div');
        header.classList.add('widget-header');
        this.mainContent.appendChild(header);
        this.header = header;
        return header;
    }

    createBackButton() {
        const backButton = document.createElement('button');
        backButton.textContent = 'Select another application';
        backButton.style.display = 'none';
        backButton.addEventListener('click', () => {
            const searchInput = this.searchInput;
            chrome.storage.local.remove('selectedApplication', () => {
                this.updateSidebar(null);
                this.resultsContainer.innerHTML = '';
                const loader = this.createLoader();
                searchInput.disabled = true;
                this.resultsContainer.appendChild(loader);
                setupApplicationSearch(searchInput, this.resultsContainer, this.targetElement, () => {
                    loader.remove();
                    searchInput.disabled = false;
                    searchInput.value = '';
                    searchInput.focus();
                });
            });
            searchInput.value = '';
            searchInput.focus();
        });
        this.mainContent.appendChild(backButton);
        this.backButton = backButton;
        return backButton;
    }

    createSearchInput() {
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        this.mainContent.appendChild(searchInput);
        this.searchInput = searchInput;
        return searchInput;
    }

    createResultsContainer() {
        const resultsContainer = document.createElement('div');
        resultsContainer.classList.add('results-container');
        resultsContainer.style.maxHeight = '300px';
        resultsContainer.style.overflowY = 'auto';
        this.mainContent.appendChild(resultsContainer);
        this.resultsContainer = resultsContainer;
        return resultsContainer;
    }

    createLoader() {
        const loader = document.createElement('div');
        loader.classList.add('loader');
        loader.textContent = 'Loading data...';
        return loader;
    }

    // Global click-outside listener: collapse sidebar if click occurs outside our host.
    attachClickOutsideListener() {
        this._globalClickHandler = (event) => {
            if (event.target.closest('[data-widget-host]')) {
                return;
            }
            this.collapseSidebar();
        };
        document.addEventListener('click', this._globalClickHandler);
    }

    collapseSidebar() {
        if (this.sidebar) {
            this.sidebar.style.display = 'none';
        }
    }

    expandSidebar() {
        if (this.sidebar) {
            this.sidebar.style.display = '';
        }
    }

    attachStorageChangeListener() {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local' && (changes.selectedApplication || changes.selectedApplicationData)) {
                // Ensure we fetch the latest selectedApplication value
                chrome.storage.local.get('selectedApplication', (data) => {
                    this.updateSidebar(data.selectedApplication);
                });
            }
        });
    }

    updateSidebar(selectedApplication) {
        if (selectedApplication) {
            if (!this.sidebar) {
                this.sidebar = document.createElement('div');
                this.sidebar.classList.add('widget-sidebar');
                this.container.insertBefore(this.sidebar, this.mainContent);
            }
            this.sidebar.innerHTML = '';
            chrome.storage.local.get('selectedApplicationData', (data) => {
                if (data.selectedApplicationData &&
                    data.selectedApplicationData.fields &&
                    typeof data.selectedApplicationData.fields === 'object') {
                    const tree = this.renderTree(data.selectedApplicationData.fields);
                    this.sidebar.appendChild(tree);
                } else {
                    const noData = document.createElement('p');
                    noData.textContent = 'No data available';
                    this.sidebar.appendChild(noData);
                }
            });
            this.header.textContent = `Application selected: ${selectedApplication.title} | ${selectedApplication.companyName}`;
            this.backButton.style.display = 'block';
        } else {
            if (this.sidebar) {
                this.sidebar.remove();
                this.sidebar = null;
            }
            this.header.textContent = 'Select an application';
            this.backButton.style.display = 'none';
        }
    }

    show() {
        if (!this.targetElement) return;
        if (!isInputOrTextarea(this.targetElement) && document.activeElement !== this.targetElement) {
            return;
        }
        if (isInputOrTextarea(this.targetElement)) {
            this.targetElement.autocomplete = 'off';
        }
        this.createWidget();
        this.createMainContentContainer();
        this.createHeader();
        this.createBackButton();
        this.createSearchInput();
        this.createResultsContainer();
        this.attachStorageChangeListener();
        chrome.storage.local.get('selectedApplication', (data) => {
            this.updateSidebar(data.selectedApplication);
            if (data.selectedApplication) {
                setupDataSearch(this.searchInput, this.resultsContainer, data.selectedApplication.uuid, this.targetElement);
            } else {
                setupApplicationSearch(this.searchInput, this.resultsContainer, this.targetElement);
            }
            this.searchInput.focus();
        });
    }

    // widget.js inside ApplicationWidget class
    destroy() {
        if (this._globalClickHandler) {
            document.removeEventListener('click', this._globalClickHandler);
            this._globalClickHandler = null;
        }
        if (this.host) {
            this.host.remove();
            this.host = null;
            this.widget = null;
        }
        // Remove the widget instance from the target element.
        if (this.targetElement) {
            delete this.targetElement._widgetInstance;
        }
    }
}