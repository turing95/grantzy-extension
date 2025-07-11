import config from './env.js';
const apiBaseUrl = config.API_URL;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "fetchApplications") {
        fetch(apiBaseUrl + '/api/spaces')
            .then(response => response.json())
            .then(data => {
                sendResponse({success: true, applications: data});
            })
            .catch(error => {
                console.error('Error fetching applications:', error);
                sendResponse({success: false, error: error.message});
            });
        // Required to keep the message channel open for asynchronous responses
        return true;
    } else if (message.action === "fetchApplicationData" && message.applicationId) {
        fetch(apiBaseUrl + `/api/spaces/${message.applicationId}`)
            .then(response => response.json())
            .then(data => {
                sendResponse({success: true, data: data});
            })
            .catch(error => {
                console.error('Error fetching application data:', error);
                sendResponse({success: false, error: error.message});
            });
        // Keep the message channel open for async response
        return true;
    }
});