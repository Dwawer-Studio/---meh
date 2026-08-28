CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
    account_id text PRIMARY KEY,
    account_kind text NOT NULL CHECK (account_kind IN ('guest', 'registered')),
    display_name text NOT NULL,
    credential_hash text,
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    sync_revision bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    upgraded_at timestamptz,
    deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS majalis (
    majlis_id text PRIMARY KEY,
    display_name text NOT NULL,
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS majlis_memberships (
    majlis_id text NOT NULL REFERENCES majalis(majlis_id) ON DELETE CASCADE,
    account_id text NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    member_role text NOT NULL CHECK (member_role IN ('owner', 'member')),
    membership_status text NOT NULL CHECK (membership_status IN ('active', 'left')),
    consented_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (majlis_id, account_id)
);

CREATE TABLE IF NOT EXISTS account_sessions (
    session_id text PRIMARY KEY,
    account_id text NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
    room_id text PRIMARY KEY,
    room_code varchar(5) NOT NULL UNIQUE,
    mode text NOT NULL CHECK (mode IN ('private', 'quick')),
    phase text NOT NULL,
    rules_version text NOT NULL,
    catalog_version text NOT NULL,
    deck_recipe_id text NOT NULL,
    match_id text,
    match_state jsonb,
    state_version bigint NOT NULL DEFAULT 0,
    server_seq bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS seats (
    room_id text NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
    seat_id text NOT NULL,
    seat_index smallint NOT NULL CHECK (seat_index BETWEEN 0 AND 3),
    account_id text REFERENCES accounts(account_id) ON DELETE SET NULL,
    display_name text NOT NULL,
    is_bot boolean NOT NULL DEFAULT false,
    status text NOT NULL CHECK (status IN ('CONNECTED', 'LEASED', 'BOT', 'LEFT')),
    ready boolean NOT NULL DEFAULT false,
    lease_token_hash text,
    lease_expires_at timestamptz,
    connection_session_id text,
    last_client_seq bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (room_id, seat_id),
    UNIQUE (room_id, seat_index)
);

CREATE TABLE IF NOT EXISTS request_idempotency (
    room_id text NOT NULL,
    seat_id text NOT NULL,
    account_id text,
    connection_session_id text NOT NULL,
    request_id text NOT NULL,
    client_seq bigint NOT NULL,
    response jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, request_id)
);

CREATE TABLE IF NOT EXISTS match_actions (
    room_id text NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
    match_id text NOT NULL,
    action_sequence bigint NOT NULL,
    account_id text REFERENCES accounts(account_id) ON DELETE SET NULL,
    request_id text NOT NULL,
    action jsonb NOT NULL,
    result_fingerprint text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, match_id, action_sequence)
);

CREATE TABLE IF NOT EXISTS audit_log (
    audit_id bigserial PRIMARY KEY,
    event_type text NOT NULL,
    account_id text REFERENCES accounts(account_id) ON DELETE SET NULL,
    room_id text,
    ip_hash text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deletion_tombstones (
    subject_hash text PRIMARY KEY,
    deleted_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS account_sessions_active_idx ON account_sessions (token_hash, expires_at)
    WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS majlis_memberships_account_idx
    ON majlis_memberships (account_id, updated_at DESC) WHERE membership_status = 'active';
CREATE INDEX IF NOT EXISTS rooms_active_idx ON rooms (phase, last_activity_at)
    WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idempotency_expiry_idx ON request_idempotency (created_at);
CREATE INDEX IF NOT EXISTS match_actions_lookup_idx ON match_actions (match_id, action_sequence);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_log (created_at);
