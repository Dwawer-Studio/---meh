'use strict';

const P3_EXPERIMENT_FLAG_MAP = Object.freeze({
    p3_recent_majalis: 'recent_majalis',
    p3_one_tap_reinvite: 'one_tap_reinvite',
    p3_majlis_session_score: 'majlis_session_score',
    p3_majlis_schedule: 'majlis_schedule',
});

function p3AssignmentBucket(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % 10_000;
}

function p3ExperimentStorage() {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null;
    } catch (error) {
        return null;
    }
}

class P3ExperimentAssignmentService {
    constructor(options = {}) {
        this.storage = options.storage || null;
        this.config = options.config || {};
        this.storageKey = options.storageKey || 'meh_experiment_assignment_v1';
        this.idFactory = options.idFactory || (() => {
            if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
                return `assignment-${window.crypto.randomUUID().replaceAll('-', '')}`;
            }
            return null;
        });
    }

    resolve(initialFlags = {}) {
        const active = Object.entries(P3_EXPERIMENT_FLAG_MAP)
            .filter(([experimentId]) => this.config[experimentId] && this.config[experimentId].active === true);
        if (!active.length) return this._result(initialFlags, {}, null);
        if (active.length !== 1) return this._failClosed(initialFlags, 'MULTIPLE_P3_EXPERIMENTS_ACTIVE');
        const [experimentId, flagName] = active[0];
        const experiment = this.config[experimentId];
        if (experiment.treatmentPercent !== 50
            || typeof experiment.salt !== 'string'
            || !/^[A-Za-z0-9_-]{8,64}$/.test(experiment.salt)) {
            return this._failClosed(initialFlags, 'INVALID_P3_EXPERIMENT_CONFIG');
        }
        const assignmentKey = this._assignmentKey();
        if (!assignmentKey) return this._failClosed(initialFlags, 'ASSIGNMENT_STORAGE_UNAVAILABLE');
        const bucket = p3AssignmentBucket(`${assignmentKey}:${experimentId}:${experiment.salt}`);
        const variant = bucket < 5_000 ? 'treatment' : 'control';
        return this._result({ ...initialFlags, [flagName]: variant === 'treatment' }, {
            [experimentId]: variant,
        }, null);
    }

    _assignmentKey() {
        if (!this.storage || typeof this.storage.getItem !== 'function'
            || typeof this.storage.setItem !== 'function') return null;
        try {
            const stored = this.storage.getItem(this.storageKey);
            if (typeof stored === 'string' && /^assignment-[A-Za-z0-9_-]{16,96}$/.test(stored)) return stored;
            const created = this.idFactory();
            if (typeof created !== 'string' || !/^assignment-[A-Za-z0-9_-]{16,96}$/.test(created)) return null;
            this.storage.setItem(this.storageKey, created);
            return created;
        } catch (error) {
            return null;
        }
    }

    _result(flags, assignments, error) {
        return Object.freeze({
            flags: Object.freeze({ ...flags }),
            assignments: Object.freeze({ ...assignments }),
            error,
        });
    }

    _failClosed(initialFlags, error) {
        const disabledExperimentFlags = Object.fromEntries(
            Object.values(P3_EXPERIMENT_FLAG_MAP).map(flagName => [flagName, false]),
        );
        return this._result({ ...initialFlags, ...disabledExperimentFlags }, {}, error);
    }
}

const p3ExperimentAssignmentService = new P3ExperimentAssignmentService({
    storage: p3ExperimentStorage(),
    config: typeof window !== 'undefined' ? window.MEH_EXPERIMENT_CONFIG : null,
});
const p3ExperimentAssignmentResult = p3ExperimentAssignmentService.resolve(
    typeof window !== 'undefined' ? window.MEH_FEATURE_FLAGS : {},
);

if (typeof window !== 'undefined') {
    window.MEH_FEATURE_FLAGS = p3ExperimentAssignmentResult.flags;
    window.MEH_EXPERIMENT_ASSIGNMENTS = p3ExperimentAssignmentResult.assignments;
    window.MEH_EXPERIMENT_CONFIG_ERROR = p3ExperimentAssignmentResult.error;
    window.P3_EXPERIMENT_FLAG_MAP = P3_EXPERIMENT_FLAG_MAP;
    window.P3ExperimentAssignmentService = P3ExperimentAssignmentService;
}
