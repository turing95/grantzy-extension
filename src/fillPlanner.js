import { levenshteinDistance } from './utils.js';

function normalize(value) {
    return String(value ?? '')
        .toLowerCase()
        .replace(/[_\-.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(value) {
    return normalize(value)
        .split(' ')
        .filter(Boolean);
}

function tokenOverlapScore(a, b) {
    const aTokens = tokenize(a);
    const bTokens = new Set(tokenize(b));
    if (!aTokens.length || !bTokens.size) {
        return 0;
    }

    const matched = aTokens.filter(token => bTokens.has(token)).length;
    return matched / aTokens.length;
}

function similarityScore(a, b) {
    const normalizedA = normalize(a);
    const normalizedB = normalize(b);

    if (!normalizedA || !normalizedB) {
        return 0;
    }

    if (normalizedA === normalizedB) {
        return 1;
    }

    const exactContainment = normalizedB.includes(normalizedA) || normalizedA.includes(normalizedB) ? 1 : 0;
    const overlap = tokenOverlapScore(normalizedA, normalizedB);
    const levDistance = levenshteinDistance(normalizedA, normalizedB);
    const levScore = 1 - (levDistance / Math.max(normalizedA.length, normalizedB.length));

    return (0.45 * exactContainment) + (0.35 * overlap) + (0.20 * Math.max(0, levScore));
}

function toDisplayValue(value) {
    if (value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function isDropdownField(field) {
    if (!field) {
        return false;
    }

    if (field.tag === 'select') {
        return true;
    }

    const kind = String(field.widgetKind || '');
    return kind.includes('select') || kind.includes('combobox');
}

export function resolveOptionMatch(field, rawValue) {
    const desired = toDisplayValue(rawValue);
    const options = Array.isArray(field?.options) ? field.options : [];

    if (!options.length || !desired) {
        return {
            confidence: 0,
            option: null,
            reason: options.length ? 'empty_value' : 'no_options'
        };
    }

    const scored = options
        .map(option => {
            const optionText = option.text ?? option.label ?? '';
            const optionValue = option.value ?? '';
            const scoreByText = similarityScore(desired, optionText);
            const scoreByValue = similarityScore(desired, optionValue);
            const score = Math.max(scoreByText, scoreByValue);

            return {
                option: {
                    text: optionText,
                    value: optionValue
                },
                score
            };
        })
        .sort((a, b) => b.score - a.score);

    const best = scored[0];

    if (!best || best.score < 0.55) {
        return {
            confidence: best ? best.score : 0,
            option: best ? best.option : null,
            reason: 'no_reasonable_option_match'
        };
    }

    return {
        confidence: best.score,
        option: best.option,
        reason: best.score >= 0.9 ? 'high_confidence_option_match' : 'low_confidence_option_match'
    };
}

function getFieldDescriptorText(field) {
    return [
        field.label,
        field.name,
        field.idAttr,
        field.placeholder,
        field.pathHint,
        field.inputType
    ]
        .filter(Boolean)
        .join(' ');
}

function getStatusFromConfidence(confidence) {
    if (confidence >= 0.9) {
        return 'auto';
    }

    if (confidence >= 0.7) {
        return 'needs_review';
    }

    return 'skipped';
}

export function buildFillPlan({ formFields = [], grantzyFields = [], memory = {} }) {
    const valueByKey = new Map(
        grantzyFields.map(field => [field.key, toDisplayValue(field.value)])
    );

    return formFields.map(field => {
        const descriptor = getFieldDescriptorText(field);

        const rankedCandidates = grantzyFields
            .map(grantzyField => {
                const keyScore = similarityScore(descriptor, grantzyField.key);
                const memoryBoost = memory?.[field.signature]?.grantzyKey === grantzyField.key ? 0.25 : 0;
                const combinedScore = Math.min(1, keyScore + memoryBoost);

                return {
                    key: grantzyField.key,
                    value: toDisplayValue(grantzyField.value),
                    score: combinedScore,
                    memoryBoost
                };
            })
            .sort((a, b) => b.score - a.score);

        const bestCandidate = rankedCandidates[0] || null;

        if (!bestCandidate || bestCandidate.score < 0.55) {
            return {
                fieldId: field.fieldId,
                fieldSignature: field.signature,
                field,
                fieldLabel: field.label || field.name || field.idAttr || field.pathHint,
                widgetKind: field.widgetKind,
                inputType: field.inputType,
                grantzyKey: null,
                grantzyValue: '',
                candidates: rankedCandidates.slice(0, 5),
                confidence: bestCandidate ? bestCandidate.score : 0,
                status: 'skipped',
                reason: 'no_reliable_field_match',
                dropdownOption: null
            };
        }

        const grantzyValue = bestCandidate.value;
        let confidence = bestCandidate.score;
        let status = getStatusFromConfidence(confidence);
        let reason = bestCandidate.memoryBoost > 0 ? 'memory_boosted_match' : 'field_match';
        let dropdownOption = null;

        if (isDropdownField(field)) {
            const optionMatch = resolveOptionMatch(field, grantzyValue);
            dropdownOption = optionMatch.option;
            confidence = Math.min(confidence, optionMatch.confidence || confidence);
            if (optionMatch.reason === 'no_options') {
                status = 'needs_review';
                reason = 'dropdown_options_not_detected';
            } else {
                status = getStatusFromConfidence(confidence);
                reason = optionMatch.reason;
            }
        }

        return {
            fieldId: field.fieldId,
            fieldSignature: field.signature,
            field,
            fieldLabel: field.label || field.name || field.idAttr || field.pathHint,
            widgetKind: field.widgetKind,
            inputType: field.inputType,
            grantzyKey: bestCandidate.key,
            grantzyValue: valueByKey.get(bestCandidate.key) ?? grantzyValue,
            candidates: rankedCandidates.slice(0, 5),
            confidence,
            status,
            reason,
            dropdownOption
        };
    });
}
