const STORAGE_KEY = 'grantzyAutofillMappingsV1';
const MAX_FORMS_PER_ORIGIN = 25;
const DEFAULT_RECENT_LIMIT = 8;

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

export async function saveMappingMemory(origin, formFingerprint, items, metadata = {}) {
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
        mappings,
        application: metadata?.application || null,
        formUrl: metadata?.formUrl || null
    };

    memory[origin] = trimOriginMemory(existingOriginMemory);
    await setStorageValue(STORAGE_KEY, memory);
}

export async function listRecentMappingMemories(limit = DEFAULT_RECENT_LIMIT) {
    const memory = await readMemory();
    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, limit) : DEFAULT_RECENT_LIMIT;
    const entries = [];

    Object.entries(memory).forEach(([origin, forms]) => {
        if (!forms || typeof forms !== 'object') {
            return;
        }

        Object.entries(forms).forEach(([formFingerprint, payload]) => {
            const mappings = payload?.mappings || {};
            const mappingKeys = Object.keys(mappings);
            entries.push({
                origin,
                formFingerprint,
                updatedAt: payload?.updatedAt || 0,
                mappingCount: mappingKeys.length,
                mappingKeys: mappingKeys.slice(0, 6),
                application: payload?.application || null,
                formUrl: payload?.formUrl || null
            });
        });
    });

    return entries
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, normalizedLimit);
}
