'use strict';

const PRODUCT_FEATURE_FLAG_DEFINITIONS = Object.freeze({
    deep_link_join: Object.freeze({ defaultValue: false, scope: 'product-entry' }),
    persistent_table: Object.freeze({ defaultValue: false, scope: 'table-session' }),
    action_journal: Object.freeze({ defaultValue: false, scope: 'presentation' }),
    contextual_ftue: Object.freeze({ defaultValue: false, scope: 'presentation' }),
    session_score: Object.freeze({ defaultValue: false, scope: 'table-session' }),
    authoritative_service: Object.freeze({ defaultValue: false, scope: 'transport' }),
    recent_majalis: Object.freeze({ defaultValue: false, scope: 'social-return' }),
    one_tap_reinvite: Object.freeze({ defaultValue: false, scope: 'social-return' }),
    majlis_session_score: Object.freeze({ defaultValue: false, scope: 'social-context' }),
    majlis_schedule: Object.freeze({ defaultValue: false, scope: 'social-return' }),
    safe_quick_chat: Object.freeze({ defaultValue: false, scope: 'social-safety' }),
    catalog_expansion: Object.freeze({ defaultValue: false, scope: 'catalog-selection' }),
    card_catalog: Object.freeze({ defaultValue: false, scope: 'catalog-discovery' }),
    tamashi_wallet: Object.freeze({ defaultValue: false, scope: 'economy' }),
    card_lab: Object.freeze({ defaultValue: false, scope: 'catalog-trial' }),
    friendly_recipes: Object.freeze({ defaultValue: false, scope: 'shared-deck-recipe' }),
    verified_iap: Object.freeze({ defaultValue: false, scope: 'economy-purchase' }),
});

class ProductFeatureFlagService {
    constructor(definitions = PRODUCT_FEATURE_FLAG_DEFINITIONS, initialValues = {}) {
        this.definitions = definitions;
        this.values = {};
        for (const [name, definition] of Object.entries(definitions)) {
            this.values[name] = definition.defaultValue === true;
        }
        this.configure(initialValues);
    }

    configure(overrides) {
        if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return this.snapshot();
        for (const [name, value] of Object.entries(overrides)) {
            if (!Object.hasOwn(this.definitions, name) || typeof value !== 'boolean') continue;
            this.values[name] = value;
        }
        return this.snapshot();
    }

    isEnabled(name) {
        return Object.hasOwn(this.definitions, name) && this.values[name] === true;
    }

    reset() {
        for (const [name, definition] of Object.entries(this.definitions)) {
            this.values[name] = definition.defaultValue === true;
        }
        return this.snapshot();
    }

    snapshot() {
        return Object.freeze({ ...this.values });
    }
}

const runtimeFeatureFlags = typeof window !== 'undefined' ? window.MEH_FEATURE_FLAGS : null;
const ProductFeatureFlags = new ProductFeatureFlagService(
    PRODUCT_FEATURE_FLAG_DEFINITIONS,
    runtimeFeatureFlags,
);

if (typeof window !== 'undefined') {
    window.PRODUCT_FEATURE_FLAG_DEFINITIONS = PRODUCT_FEATURE_FLAG_DEFINITIONS;
    window.ProductFeatureFlagService = ProductFeatureFlagService;
    window.ProductFeatureFlags = ProductFeatureFlags;
}
