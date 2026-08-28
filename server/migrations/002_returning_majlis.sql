ALTER TABLE majalis
    ADD COLUMN owner_account_id text REFERENCES accounts(account_id) ON DELETE SET NULL,
    ADD COLUMN source_room_id text REFERENCES rooms(room_id) ON DELETE SET NULL
        DEFERRABLE INITIALLY DEFERRED,
    ADD COLUMN banner_id text NOT NULL DEFAULT 'pearl',
    ADD COLUMN table_theme_id text NOT NULL DEFAULT 'classic',
    ADD COLUMN majlis_status text NOT NULL DEFAULT 'active'
        CHECK (majlis_status IN ('active', 'archived'));

ALTER TABLE rooms
    ADD COLUMN majlis_id text REFERENCES majalis(majlis_id) ON DELETE SET NULL
        DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE majlis_sessions (
    majlis_session_id text PRIMARY KEY,
    majlis_id text NOT NULL REFERENCES majalis(majlis_id) ON DELETE CASCADE,
    room_id text REFERENCES rooms(room_id) ON DELETE SET NULL,
    match_id text NOT NULL,
    completed_at timestamptz NOT NULL,
    UNIQUE (room_id, match_id)
);

CREATE TABLE majlis_session_players (
    majlis_session_id text NOT NULL REFERENCES majlis_sessions(majlis_session_id) ON DELETE CASCADE,
    player_index smallint NOT NULL CHECK (player_index BETWEEN 0 AND 3),
    account_id text REFERENCES accounts(account_id) ON DELETE SET NULL,
    display_name text NOT NULL,
    won boolean NOT NULL DEFAULT false,
    PRIMARY KEY (majlis_session_id, player_index)
);

CREATE TABLE majlis_invitations (
    invitation_id text PRIMARY KEY,
    majlis_id text NOT NULL REFERENCES majalis(majlis_id) ON DELETE CASCADE,
    created_by_account_id text REFERENCES accounts(account_id) ON DELETE SET NULL,
    scheduled_for timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL,
    canceled_at timestamptz
);

CREATE TABLE majlis_reminders (
    invitation_id text NOT NULL REFERENCES majlis_invitations(invitation_id) ON DELETE CASCADE,
    account_id text NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    remind_at timestamptz NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    notified_at timestamptz,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (invitation_id, account_id)
);

CREATE TABLE moderation_reports (
    report_id text PRIMARY KEY,
    room_id text REFERENCES rooms(room_id) ON DELETE SET NULL,
    match_id text,
    reporter_account_id text REFERENCES accounts(account_id) ON DELETE SET NULL,
    reported_account_id text REFERENCES accounts(account_id) ON DELETE SET NULL,
    reason_code text NOT NULL CHECK (reason_code IN ('spam', 'harassment', 'stalling', 'collusion')),
    report_status text NOT NULL DEFAULT 'open'
        CHECK (report_status IN ('open', 'reviewing', 'closed', 'dismissed')),
    created_at timestamptz NOT NULL,
    reviewed_at timestamptz,
    UNIQUE (room_id, match_id, reporter_account_id, reported_account_id)
);

CREATE INDEX majlis_sessions_recent_idx ON majlis_sessions (majlis_id, completed_at DESC);
CREATE UNIQUE INDEX majalis_source_room_idx ON majalis (source_room_id) WHERE source_room_id IS NOT NULL;
CREATE UNIQUE INDEX rooms_one_forming_per_majlis_idx
    ON rooms (majlis_id) WHERE majlis_id IS NOT NULL AND closed_at IS NULL AND phase = 'FORMING';
CREATE INDEX majlis_invitations_due_idx
    ON majlis_invitations (scheduled_for) WHERE canceled_at IS NULL;
CREATE INDEX moderation_reports_open_idx
    ON moderation_reports (created_at) WHERE report_status IN ('open', 'reviewing');
