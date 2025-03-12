// Static imports at the top.
import { isInputOrTextarea } from './utils.js';
import { setupApplicationSearch, setupDataSearch, flattenFields, updateDataResults, resultsSelection } from './searchHandler.js';

export class ApplicationWidget {
  constructor(targetElement) {
    this.targetElement = targetElement;
    this.widget = null;
    this.container = null; // Flex container for sidebar and main content
    this.sidebar = null;
    this.mainContent = null;
    this.header = null;
    this.searchInput = null;
    this.resultsContainer = null;
    this.backButton = null;
    // New properties for search context:
    this.selectedTreeNodeData = null;
    this.selectedTreeNodeElement = null;
    // Used to delay sidebar restoration
    this.expandTimeout = null;
    // Flag for delayed restore after minimizing whole widget.
    this.canRestore = true;
  }

  createWidget() {
    const widget = document.createElement('div');
    widget.classList.add('grantzy-widget');
    widget.style.position = 'fixed';
    widget.style.visibility = 'hidden'; // Hide initially while positioning
    document.body.appendChild(widget);
    this.widget = widget;
    this.positionWidget();

    // Create control buttons (Close and Minimize).
    this.createControlButtons();

    // Create a container to hold the sidebar and main content.
    const container = document.createElement('div');
    container.classList.add('widget-container');
    widget.appendChild(container);
    this.container = container;

    // Add delayed mouseover and mouseout events for expanding the sidebar.
    widget.addEventListener('mouseover', () => {
      clearTimeout(this.expandTimeout);
      this.expandTimeout = setTimeout(() => {
        this.restoreWholeWidget();
        this.expandSidebar();
      }, 500); // 500ms delay before expanding the sidebar
    });
    widget.addEventListener('mouseout', () => {
      clearTimeout(this.expandTimeout);
    });

    // Reposition widget when its content changes.
    const observer = new MutationObserver(() => this.positionWidget());
    observer.observe(widget, { childList: true, subtree: true });

    // Render and then show the widget.
    requestAnimationFrame(() => {
      this.positionWidget();
      widget.style.visibility = 'visible';
    });
    return widget;
  }

  // Always position the widget at the top right of the screen.
  positionWidget() {
    if (!this.widget) return;
    const spacing = 20; // Margin from the top and right edges.
    this.widget.style.top = `${spacing}px`;
    this.widget.style.right = `${spacing}px`;
    this.widget.style.left = 'auto'; // Clear left positioning.
  }

  // Create control buttons: one for minimizing the entire widget and one for closing it.
  createControlButtons() {
    const controls = document.createElement('div');
    controls.classList.add('widget-controls');
    controls.style.position = 'absolute';
    controls.style.top = '5px';
    controls.style.right = '5px';

    const minimizeBtn = document.createElement('button');
    minimizeBtn.classList.add('widget-minimize-btn');
    minimizeBtn.textContent = '–';
    minimizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.minimizeWholeWidget();
    });

    const closeBtn = document.createElement('button');
    closeBtn.classList.add('widget-close-btn');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.destroy();
    });

    controls.appendChild(minimizeBtn);
    controls.appendChild(closeBtn);
    this.widget.appendChild(controls);
  }

  // Minimizes the entire widget by adding a "minimized" class and delays restoration.
  minimizeWholeWidget() {
    if (this.widget && !this.widget.classList.contains('minimized')) {
      this.widget.classList.add('minimized');
      this.canRestore = false;
      setTimeout(() => {
        this.canRestore = true;
      }, 2000); // 2-second delay before it can be restored on hover
    }
  }

  // Restores the entire widget by removing the "minimized" class if allowed.
  restoreWholeWidget() {
    if (this.widget && this.widget.classList.contains('minimized') && this.canRestore) {
      this.widget.classList.remove('minimized');
    }
  }

  createMainContentContainer() {
    const mainContent = document.createElement('div');
    mainContent.classList.add('widget-main');
    this.container.appendChild(mainContent);
    this.mainContent = mainContent;
    return mainContent;
  }

  // Updated renderTree method remains similar.
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

  // Sets the selected node and triggers a search.
  setSelectedTreeNode(data, liElement) {
    this.selectedTreeNodeData = data;
    if (this.selectedTreeNodeElement && this.selectedTreeNodeElement !== liElement) {
      this.selectedTreeNodeElement.classList.remove('selected');
    }
    liElement.classList.add('selected');
    this.selectedTreeNodeElement = liElement;
    this.targetElement.searchContextData = data;
    this.triggerSearchForSelectedNode();
  }

  // Clears the selected node.
  clearSelectedTreeNode() {
    if (this.selectedTreeNodeElement) {
      this.selectedTreeNodeElement.classList.remove('selected');
      this.selectedTreeNodeElement = null;
    }
    this.selectedTreeNodeData = null;
    this.targetElement.searchContextData = null;
  }

  // Triggers a search displaying all sub-fields of the selected node.
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

  // Instead of minimizing the whole widget when clicking outside,
  // collapse just the sidebar.
  attachClickOutsideListener() {
    const handleClickOutside = (event) => {
      if (!this.widget.contains(event.target)) {
        this.collapseSidebar();
      }
    };
    document.addEventListener('click', handleClickOutside);
  }

  // Collapses (hides) the sidebar.
  collapseSidebar() {
    if (this.sidebar) {
      this.sidebar.style.display = 'none';
    }
  }

  // Expands (shows) the sidebar.
  expandSidebar() {
    if (this.sidebar) {
      this.sidebar.style.display = ''; // Reset to default display.
    }
  }

  attachStorageChangeListener() {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local' && changes.selectedApplication) {
        const newValue = changes.selectedApplication.newValue;
        this.updateSidebar(newValue);
      }
    });
  }

  // Updates the sidebar using lazy tree built from "selectedApplicationData".
  updateSidebar(selectedApplication) {
    if (selectedApplication) {
      if (!this.sidebar) {
        this.sidebar = document.createElement('div');
        this.sidebar.classList.add('widget-sidebar');
        this.container.insertBefore(this.sidebar, this.mainContent);
      }
      // Clear existing content.
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
    if (document.querySelector('.grantzy-widget')) return;
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
    this.attachClickOutsideListener();
  }

  destroy() {
    if (this.widget) {
      this.widget.remove();
    }
  }
}