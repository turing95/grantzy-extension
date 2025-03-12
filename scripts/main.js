import { attachListenersToAllElements,handleGlobalKeyUp } from './eventManager.js';

document.addEventListener('keyup', handleGlobalKeyUp);

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
            displayApplicationSearchWidget(mutation.target.parentElement);
        }
    });
});

observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
});

let applications = [];

// Send a message to the background script
chrome.runtime.sendMessage(
    {action: "fetchApplications"},
    (response) => {
        if (chrome.runtime.lastError) {
            console.error("Message Error:", chrome.runtime.lastError);
        } else if (response.success) {
            applications = response.applications;
        } else {
            console.error("Error fetching applications:", response.error);
        }
    }
);