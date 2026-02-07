const STORAGE_KEY = 'grantzyAutofillMappingsV1';
const MAX_FORMS_PER_ORIGIN = 25;

function getStorageValue(key) {
    return new Promise(resolve => {
        chrome.storage.local.get(key, data => resolve(data[key]));
    });
}

function setStorageValue(key, value) {
    return new Promise(resolve => {
        chrome.storage.local.set({ [key]: value }, () => resolve());
    });
}

async function readMemory() {
    const memory = await getStorageValue(STORAGE_KEY);
    if (!memory || typeof memory !== 'object') {
        return {};
    }

    return memory;
}

export async function loadMappingMemory(origin, formFingerprint) {
    const memory = await readMemory();
    return memory?.[origin]?.[formFingerprint]?.mappings || {};
}

function trimOriginMemory(originMemory) {
    const entries = Object.entries(originMemory);
    if (entries.length <= MAX_FORMS_PER_ORIGIN) {
        return originMemory;
    }

    const sorted = entries.sort((a, b) => {
        const aTime = a[1]?.updatedAt || 0;
        const bTime = b[1]?.updatedAt || 0;
        return bTime - aTime;
    });

    return Object.fromEntries(sorted.slice(0, MAX_FORMS_PER_ORIGIN));
}

export async function saveMappingMemory(origin, formFingerprint, items) {
    if (!origin || !formFingerprint || !Array.isArray(items) || !items.length) {
        return;
    }

    const mappings = {};

    items.forEach(item => {
        if (!item?.fieldSignature || !item?.grantzyKey) {
            return;
        }

        mappings[item.fieldSignature] = {
            grantzyKey: item.grantzyKey,
            dropdownOptionText: item.dropdownOption?.text || null,
            dropdownOptionValue: item.dropdownOption?.value || null
        };
    });

    if (!Object.keys(mappings).length) {
        return;
    }

    const memory = await readMemory();
    const existingOriginMemory = memory[origin] || {};

    existingOriginMemory[formFingerprint] = {
        updatedAt: Date.now(),
        mappings
    };

    memory[origin] = trimOriginMemory(existingOriginMemory);
    await setStorageValue(STORAGE_KEY, memory);
}
