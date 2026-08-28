'use strict';

// P1 ships as a reversible release bundle. A host page may set any key to
// false before this script loads to roll that slice back without changing the
// immutable feature-flag defaults established in P0.
const P1_RELEASE_DEFAULTS = Object.freeze({
    deep_link_join: true,
    persistent_table: true,
    action_journal: true,
    contextual_ftue: true,
    session_score: true,
});

const P2_RELEASE_DEFAULTS = Object.freeze({
    authoritative_service: typeof window.MEH_SERVICE_URL === 'string',
});

window.MEH_FEATURE_FLAGS = Object.freeze({
    ...P1_RELEASE_DEFAULTS,
    ...P2_RELEASE_DEFAULTS,
    ...(window.MEH_FEATURE_FLAGS || {}),
});
