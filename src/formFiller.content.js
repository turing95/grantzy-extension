(() => {
    if (window.__grantzyAutofillBootstrap) {
        return;
    }
    window.__grantzyAutofillBootstrap = true;

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const REVIEW_HIGHLIGHT_CLASS = 'grantzy-fill-review-highlight';
    const REVIEW_HIGHLIGHT_STYLE_ID = 'grantzy-fill-review-highlight-style';

    function ensureReviewHighlightStyles() {
        if (document.getElementById(REVIEW_HIGHLIGHT_STYLE_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = REVIEW_HIGHLIGHT_STYLE_ID;
        style.textContent = `
            .${REVIEW_HIGHLIGHT_CLASS} {
                outline: 2px solid #fbbf24 !important;
                outline-offset: 2px !important;
                background-color: rgba(253, 224, 71, 0.2) !important;
                transition: outline-color 120ms ease, background-color 120ms ease;
            }
        `;
        document.documentElement.appendChild(style);
    }

    function clearReviewHighlights() {
        document.querySelectorAll(`.${REVIEW_HIGHLIGHT_CLASS}`).forEach(element => {
            element.classList.remove(REVIEW_HIGHLIGHT_CLASS);
        });
    }

    function normalize(value) {
        return String(value ?? '')
            .toLowerCase()
            .replace(/[_\-.]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function similarityScore(a, b) {
        const left = normalize(a);
        const right = normalize(b);

        if (!left || !right) {
            return 0;
        }

        if (left === right) {
            return 1;
        }

        const contains = left.includes(right) || right.includes(left) ? 1 : 0;
        const leftTokens = left.split(' ').filter(Boolean);
        const rightTokens = new Set(right.split(' ').filter(Boolean));
        const overlap = leftTokens.length
            ? leftTokens.filter(token => rightTokens.has(token)).length / leftTokens.length
            : 0;

        return (0.55 * contains) + (0.45 * overlap);
    }

    function isVisible(element) {
        if (!element || !(element instanceof Element)) {
            return false;
        }

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function findLabelText(element) {
        if (!element) {
            return '';
        }

        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) {
            return ariaLabel.trim();
        }

        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
            const labelElement = document.getElementById(labelledBy);
            if (labelElement?.textContent) {
                return labelElement.textContent.trim();
            }
        }

        if (element.id) {
            const associated = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
            if (associated?.textContent) {
                return associated.textContent.trim();
            }
        }

        const wrappedLabel = element.closest('label');
        if (wrappedLabel?.textContent) {
            return wrappedLabel.textContent.trim();
        }

        const formGroup = element.closest('div, td, th, li, p');
        if (formGroup) {
            const siblingLabel = formGroup.querySelector('label, legend, .label, .field-label');
            if (siblingLabel?.textContent) {
                return siblingLabel.textContent.trim();
            }
        }

        return '';
    }

    function detectWidgetKind(element) {
        const tag = element.tagName.toLowerCase();
        const role = element.getAttribute('role') || '';
        const type = (element.getAttribute('type') || '').toLowerCase();

        if (tag === 'textarea') {
            return 'native-textarea';
        }

        if (tag === 'select') {
            return 'native-select';
        }

        if (tag === 'input') {
            if (type === 'checkbox') return 'native-checkbox';
            if (type === 'radio') return 'native-radio';
            return 'native-input';
        }

        if (element.closest('.ant-select')) {
            return 'antd-select';
        }

        if (element.closest('.MuiSelect-root') || element.className?.toString().includes('MuiSelect')) {
            return 'mui-select';
        }

        if (element.closest('[class*="react-select"]') || element.className?.toString().includes('react-select')) {
            return 'react-select';
        }

        if (role === 'combobox') {
            return 'custom-combobox';
        }

        return 'unknown';
    }

    function getReviewHighlightTarget(element, widgetKind) {
        if (!element) {
            return null;
        }

        if (widgetKind === 'antd-select' || widgetKind === 'mui-select' || widgetKind === 'react-select' || widgetKind === 'custom-combobox') {
            return element.querySelector('[role="combobox"]') ||
                element.querySelector('.ant-select-selector') ||
                element.querySelector('.MuiSelect-select') ||
                element;
        }

        if (widgetKind === 'native-radio') {
            return element.closest('label') || element.parentElement || element;
        }

        return element;
    }

    function markFieldForReview(element, widgetKind) {
        const target = getReviewHighlightTarget(element, widgetKind);
        if (!target) {
            return false;
        }

        ensureReviewHighlightStyles();
        target.classList.add(REVIEW_HIGHLIGHT_CLASS);
        return true;
    }

    function getCssPath(element) {
        if (!(element instanceof Element)) {
            return '';
        }

        const path = [];
        let current = element;

        while (current && current.nodeType === Node.ELEMENT_NODE && path.length < 6) {
            let selector = current.nodeName.toLowerCase();
            if (current.id) {
                selector += `#${CSS.escape(current.id)}`;
                path.unshift(selector);
                break;
            }

            const nameAttr = current.getAttribute('name');
            if (nameAttr) {
                selector += `[name="${CSS.escape(nameAttr)}"]`;
            }

            const siblings = current.parentElement
                ? Array.from(current.parentElement.children).filter(child => child.nodeName === current.nodeName)
                : [];

            if (siblings.length > 1) {
                const index = siblings.indexOf(current) + 1;
                selector += `:nth-of-type(${index})`;
            }

            path.unshift(selector);
            current = current.parentElement;
        }

        return path.join(' > ');
    }

    function collectOptions(element, widgetKind) {
        if (!element) {
            return [];
        }

        if (widgetKind === 'native-select') {
            return Array.from(element.options || []).map(option => ({
                text: option.textContent?.trim() || '',
                value: option.value ?? ''
            }));
        }

        const role = element.getAttribute('role');
        if (role === 'combobox') {
            const listboxId = element.getAttribute('aria-controls');
            if (listboxId) {
                const listbox = document.getElementById(listboxId);
                if (listbox) {
                    return Array.from(listbox.querySelectorAll('[role="option"]')).map(option => ({
                        text: option.textContent?.trim() || '',
                        value: option.getAttribute('data-value') || option.textContent?.trim() || ''
                    }));
                }
            }
        }

        return [];
    }

    function getRepresentativeElement(element) {
        if (!element) {
            return null;
        }

        if (element.closest('.ant-select')) {
            return element.closest('.ant-select');
        }

        if (element.closest('.MuiSelect-root')) {
            return element.closest('.MuiSelect-root');
        }

        if (element.closest('[class*="react-select"]')) {
            return element.closest('[class*="react-select"]');
        }

        return element;
    }

    function shouldIncludeElement(element) {
        if (!element) {
            return false;
        }

        if (element.tagName.toLowerCase() === 'input') {
            const type = (element.getAttribute('type') || '').toLowerCase();
            if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'file') {
                return false;
            }
        }

        return true;
    }

    function discoverFields() {
        const allCandidates = Array.from(document.querySelectorAll(
            'input, textarea, select, [role="combobox"], .ant-select, .MuiSelect-root, [class*="react-select"]'
        ));

        const uniqueElements = [];
        const seen = new Set();

        allCandidates.forEach(candidate => {
            const representative = getRepresentativeElement(candidate);
            if (!representative || !shouldIncludeElement(representative) || !isVisible(representative)) {
                return;
            }

            if (seen.has(representative)) {
                return;
            }

            seen.add(representative);
            uniqueElements.push(representative);
        });

        return uniqueElements.map((element, index) => {
            const tag = element.tagName.toLowerCase();
            const widgetKind = detectWidgetKind(element);
            const label = findLabelText(element);
            const name = element.getAttribute('name') || '';
            const idAttr = element.id || '';
            const placeholder = element.getAttribute('placeholder') || '';
            const inputType = (element.getAttribute('type') || '').toLowerCase();
            const required = element.required || element.getAttribute('aria-required') === 'true';
            const pathHint = getCssPath(element);
            const signature = normalize(`${widgetKind}|${label}|${name}|${idAttr}|${placeholder}|${pathHint}`);

            return {
                fieldId: `field_${index + 1}`,
                signature,
                tag,
                inputType,
                label,
                name,
                idAttr,
                placeholder,
                required,
                visible: true,
                widgetKind,
                options: collectOptions(element, widgetKind),
                pathHint
            };
        });
    }

    function buildFingerprint(fields) {
        const material = fields
            .map(field => field.signature)
            .sort()
            .join('|');

        let hash = 0;
        for (let i = 0; i < material.length; i++) {
            hash = ((hash << 5) - hash) + material.charCodeAt(i);
            hash |= 0;
        }

        return `fp_${Math.abs(hash)}`;
    }

    function scanForm() {
        const fields = discoverFields();
        return {
            success: true,
            origin: window.location.origin,
            url: window.location.href,
            formFingerprint: buildFingerprint(fields),
            fields
        };
    }

    function dispatchValueEvents(element) {
        ['input', 'change', 'blur'].forEach(eventName => {
            element.dispatchEvent(new Event(eventName, { bubbles: true }));
        });
    }

    function setInputLikeValue(element, value) {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
        if (descriptor?.set) {
            descriptor.set.call(element, value);
        } else {
            element.value = value;
        }
        dispatchValueEvents(element);
    }

    function findByLabelText(label) {
        if (!label) {
            return null;
        }

        const labels = Array.from(document.querySelectorAll('label'));
        const matchingLabel = labels.find(candidate => normalize(candidate.textContent).includes(normalize(label)));
        if (!matchingLabel) {
            return null;
        }

        if (matchingLabel.htmlFor) {
            return document.getElementById(matchingLabel.htmlFor);
        }

        return matchingLabel.querySelector('input, textarea, select, [role="combobox"]');
    }

    function resolveElement(field) {
        if (!field) {
            return null;
        }

        if (field.pathHint) {
            try {
                const byPath = document.querySelector(field.pathHint);
                if (byPath) {
                    return byPath;
                }
            } catch {
                // noop
            }
        }

        if (field.idAttr) {
            const byId = document.getElementById(field.idAttr);
            if (byId) {
                return byId;
            }
        }

        if (field.name) {
            const byName = document.querySelector(`${field.tag || ''}[name="${CSS.escape(field.name)}"]`) ||
                document.querySelector(`[name="${CSS.escape(field.name)}"]`);
            if (byName) {
                return byName;
            }
        }

        return findByLabelText(field.label);
    }

    function getOptionElements(widgetKind) {
        if (widgetKind === 'antd-select') {
            return Array.from(document.querySelectorAll('.ant-select-item-option'));
        }

        if (widgetKind === 'mui-select') {
            return Array.from(document.querySelectorAll('li[role="option"]'));
        }

        if (widgetKind === 'react-select') {
            return Array.from(document.querySelectorAll('[class*="react-select"][class*="option"], [id*="react-select"][id*="option"]'));
        }

        return Array.from(document.querySelectorAll('[role="option"]'));
    }

    function chooseBestOption(options, desiredValue) {
        const desired = normalize(desiredValue);
        if (!desired) {
            return null;
        }

        const scored = options
            .map(option => {
                const text = option.textContent?.trim() || '';
                return {
                    option,
                    score: similarityScore(desired, text)
                };
            })
            .sort((a, b) => b.score - a.score);

        const best = scored[0];
        if (!best || best.score < 0.55) {
            return null;
        }

        return best.option;
    }

    function capturePreviousState(element, field) {
        const tag = element.tagName.toLowerCase();
        return {
            field,
            previousValue: element.value ?? '',
            previousChecked: typeof element.checked === 'boolean' ? element.checked : null,
            previousText: element.textContent?.trim() || '',
            tag
        };
    }

    function parseBoolean(value) {
        const normalized = normalize(value);
        return ['true', 'yes', '1', 'checked', 'on'].includes(normalized);
    }

    function setNativeSelectValue(element, desiredValue, preferredOption) {
        const options = Array.from(element.options || []);
        if (!options.length) {
            return { success: false, reason: 'no_options' };
        }

        let matched = null;

        if (preferredOption?.value) {
            matched = options.find(option => normalize(option.value) === normalize(preferredOption.value));
        }

        if (!matched && preferredOption?.text) {
            matched = options.find(option => normalize(option.textContent) === normalize(preferredOption.text));
        }

        if (!matched) {
            const exact = options.find(option => {
                return normalize(option.value) === normalize(desiredValue) ||
                    normalize(option.textContent) === normalize(desiredValue);
            });
            if (exact) {
                matched = exact;
            }
        }

        if (!matched) {
            const optionCandidate = chooseBestOption(options, desiredValue);
            matched = optionCandidate;
        }

        if (!matched) {
            return { success: false, reason: 'no_matching_option' };
        }

        element.value = matched.value;
        dispatchValueEvents(element);
        return { success: true, reason: 'filled', appliedValue: matched.value };
    }

    async function setCustomDropdownValue(element, desiredValue, widgetKind) {
        const trigger = element.querySelector('[role="combobox"]') ||
            element.querySelector('.ant-select-selector') ||
            element.querySelector('.MuiSelect-select') ||
            element;

        trigger.click();
        await sleep(120);

        const options = getOptionElements(widgetKind);
        if (!options.length) {
            return { success: false, reason: 'custom_options_not_found' };
        }

        const bestOption = chooseBestOption(options, desiredValue);
        if (!bestOption) {
            return { success: false, reason: 'custom_option_match_failed' };
        }

        bestOption.click();
        await sleep(80);
        return {
            success: true,
            reason: 'filled',
            appliedValue: bestOption.textContent?.trim() || desiredValue
        };
    }

    async function applySingleField(item) {
        const element = resolveElement(item.field);
        if (!element) {
            return { fieldId: item.fieldId, status: 'skipped', reason: 'field_not_found' };
        }

        const previousState = capturePreviousState(element, item.field);
        const desiredValue = String(item.grantzyValue ?? '');
        const widgetKind = item.field?.widgetKind || detectWidgetKind(element);
        const shouldHighlightReview = String(item?.status || '') === 'needs_review';
        const maybeMarkReview = (targetElement = element, targetWidgetKind = widgetKind) => (
            shouldHighlightReview ? markFieldForReview(targetElement, targetWidgetKind) : false
        );

        try {
            if (widgetKind === 'native-checkbox') {
                element.checked = parseBoolean(desiredValue);
                dispatchValueEvents(element);
                return {
                    fieldId: item.fieldId,
                    status: 'filled',
                    reason: 'filled',
                    appliedValue: String(element.checked),
                    previousState,
                    reviewHighlighted: maybeMarkReview(element, widgetKind)
                };
            }

            if (widgetKind === 'native-radio') {
                if (!element.name) {
                    return { fieldId: item.fieldId, status: 'skipped', reason: 'radio_without_name' };
                }

                const candidates = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(element.name)}"]`));
                const target = candidates.find(candidate => {
                    const labelText = findLabelText(candidate);
                    return normalize(candidate.value) === normalize(desiredValue) ||
                        normalize(labelText) === normalize(desiredValue);
                });

                if (!target) {
                    return { fieldId: item.fieldId, status: 'skipped', reason: 'radio_option_not_found' };
                }

                target.checked = true;
                dispatchValueEvents(target);
                return {
                    fieldId: item.fieldId,
                    status: 'filled',
                    reason: 'filled',
                    appliedValue: target.value,
                    previousState,
                    reviewHighlighted: maybeMarkReview(target, widgetKind)
                };
            }

            if (widgetKind === 'native-select') {
                const result = setNativeSelectValue(element, desiredValue, item.dropdownOption || null);
                return {
                    fieldId: item.fieldId,
                    status: result.success ? 'filled' : 'skipped',
                    reason: result.reason,
                    appliedValue: result.appliedValue,
                    previousState,
                    reviewHighlighted: result.success ? maybeMarkReview(element, widgetKind) : false
                };
            }

            if (widgetKind === 'antd-select' || widgetKind === 'mui-select' || widgetKind === 'react-select' || widgetKind === 'custom-combobox') {
                const dropdownValue = item.dropdownOption?.text || item.dropdownOption?.value || desiredValue;
                const result = await setCustomDropdownValue(element, dropdownValue, widgetKind);
                return {
                    fieldId: item.fieldId,
                    status: result.success ? 'filled' : 'skipped',
                    reason: result.reason,
                    appliedValue: result.appliedValue,
                    previousState,
                    reviewHighlighted: result.success ? maybeMarkReview(element, widgetKind) : false
                };
            }

            if (element.tagName.toLowerCase() === 'textarea' || element.tagName.toLowerCase() === 'input') {
                setInputLikeValue(element, desiredValue);
                return {
                    fieldId: item.fieldId,
                    status: 'filled',
                    reason: 'filled',
                    appliedValue: desiredValue,
                    previousState,
                    reviewHighlighted: maybeMarkReview(element, widgetKind)
                };
            }

            return { fieldId: item.fieldId, status: 'skipped', reason: 'unsupported_widget' };
        } catch (error) {
            return {
                fieldId: item.fieldId,
                status: 'skipped',
                reason: error.message || 'fill_error'
            };
        }
    }

    async function applyFillPlan(planItems) {
        const items = Array.isArray(planItems) ? planItems : [];
        const results = [];
        const previousStates = [];
        clearReviewHighlights();

        for (const item of items) {
            const result = await applySingleField(item);
            results.push(result);
            if (result.status === 'filled' && result.previousState) {
                previousStates.push(result.previousState);
            }
        }

        window.__grantzyLastFillState = {
            timestamp: Date.now(),
            entries: previousStates
        };

        return {
            success: true,
            results
        };
    }

    async function restoreSingleState(entry) {
        const element = resolveElement(entry.field);
        if (!element) {
            return false;
        }

        const widgetKind = entry.field?.widgetKind || detectWidgetKind(element);
        if (widgetKind === 'native-checkbox' || widgetKind === 'native-radio') {
            if (typeof entry.previousChecked === 'boolean') {
                element.checked = entry.previousChecked;
                dispatchValueEvents(element);
                return true;
            }
            return false;
        }

        if (widgetKind === 'native-select') {
            element.value = entry.previousValue;
            dispatchValueEvents(element);
            return true;
        }

        if (widgetKind === 'antd-select' || widgetKind === 'mui-select' || widgetKind === 'react-select' || widgetKind === 'custom-combobox') {
            const result = await setCustomDropdownValue(element, entry.previousValue || entry.previousText || '', widgetKind);
            return result.success;
        }

        if (element.tagName.toLowerCase() === 'textarea' || element.tagName.toLowerCase() === 'input') {
            setInputLikeValue(element, entry.previousValue || '');
            return true;
        }

        return false;
    }

    async function undoLastFill() {
        const state = window.__grantzyLastFillState;
        clearReviewHighlights();
        if (!state || !Array.isArray(state.entries) || !state.entries.length) {
            return {
                success: true,
                undone: 0,
                reason: 'no_previous_fill_state'
            };
        }

        let undone = 0;
        for (const entry of state.entries) {
            const restored = await restoreSingleState(entry);
            if (restored) {
                undone += 1;
            }
        }

        window.__grantzyLastFillState = {
            timestamp: Date.now(),
            entries: []
        };

        return {
            success: true,
            undone,
            reason: 'undo_completed'
        };
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || typeof message !== 'object') {
            return undefined;
        }

        if (message.action === '__grantzy_scan_form') {
            sendResponse(scanForm());
            return true;
        }

        if (message.action === '__grantzy_apply_fill') {
            applyFillPlan(message.planItems)
                .then(result => sendResponse(result))
                .catch(error => sendResponse({ success: false, error: error.message || 'apply_failed' }));
            return true;
        }

        if (message.action === '__grantzy_undo_fill') {
            undoLastFill()
                .then(result => sendResponse(result))
                .catch(error => sendResponse({ success: false, error: error.message || 'undo_failed' }));
            return true;
        }

        return undefined;
    });
})();
