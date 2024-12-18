chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "fetchCompanies") {
        fetch('https://grantzy.com/api/companies/')
            .then(response => response.json())
            .then(data => {
                sendResponse({success: true, companies: data});
            })
            .catch(error => {
                console.error('Error fetching companies:', error);
                sendResponse({success: false, error: error.message});
            });
        // Required to keep the message channel open for asynchronous responses
        return true;
    } else if (message.action === "fetchCompanyData" && message.companyId) {
        fetch(`https://grantzy.com/api/companies/${message.companyId}`)
            .then(response => response.json())
            .then(data => {
                sendResponse({success: true, data: data});
            })
            .catch(error => {
                console.error('Error fetching company data:', error);
                sendResponse({success: false, error: error.message});
            });
        // Keep the message channel open for async response
        return true;
    }
});