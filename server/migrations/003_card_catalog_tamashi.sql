ALTER TABLE rooms
    ADD COLUMN base_recipe_id text NOT NULL DEFAULT 'classic-60-v1',
    ADD COLUMN recipe_contributions jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN recipe_snapshot jsonb,
    ADD COLUMN recipe_locked_at timestamptz,
    ADD COLUMN match_participants jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE tamashi_wallets (
    account_id text PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
    balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
    lifetime_gameplay bigint NOT NULL DEFAULT 0 CHECK (lifetime_gameplay >= 0),
    lifetime_purchased bigint NOT NULL DEFAULT 0 CHECK (lifetime_purchased >= 0),
    lifetime_spent bigint NOT NULL DEFAULT 0 CHECK (lifetime_spent >= 0),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tamashi_ledger_entries (
    ledger_id text PRIMARY KEY,
    account_id text REFERENCES accounts(account_id) ON DELETE SET NULL,
    direction text NOT NULL CHECK (direction IN ('credit', 'debit')),
    amount bigint NOT NULL CHECK (amount > 0),
    source_type text NOT NULL CHECK (source_type IN (
        'verified_gameplay', 'verified_in_app_purchase', 'card_unlock', 'catch_up_adjustment'
    )),
    idempotency_key text NOT NULL,
    balance_after bigint NOT NULL CHECK (balance_after >= 0),
    room_id text,
    match_id text,
    definition_id text,
    provider_transaction_id text,
    participant_hash text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    provider text,
    wallet_revision bigint NOT NULL CHECK (wallet_revision > 0),
    created_at timestamptz NOT NULL,
    UNIQUE (account_id, idempotency_key)
);

CREATE TABLE card_unlocks (
    account_id text NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    definition_id text NOT NULL,
    acquired_with text NOT NULL CHECK (acquired_with IN ('tamashi')),
    tamashi_price bigint NOT NULL CHECK (tamashi_price > 0),
    unlocked_at timestamptz NOT NULL,
    PRIMARY KEY (account_id, definition_id)
);

CREATE TABLE verified_iap_receipts (
    provider text NOT NULL,
    provider_transaction_id text NOT NULL,
    account_id text REFERENCES accounts(account_id) ON DELETE SET NULL,
    product_sku text NOT NULL,
    tamashi_amount bigint NOT NULL CHECK (tamashi_amount > 0),
    receipt_hash text NOT NULL,
    verified_at timestamptz NOT NULL,
    PRIMARY KEY (provider, provider_transaction_id)
);

CREATE TABLE match_reward_settlements (
    match_id text PRIMARY KEY,
    room_id text NOT NULL,
    participant_hash text NOT NULL,
    reward_status text NOT NULL CHECK (reward_status IN (
        'granted', 'suppressed_group_cap', 'suppressed_account_cap', 'no_eligible_players'
    )),
    settled_at timestamptz NOT NULL
);

CREATE TABLE tamashi_reward_cohorts (
    participant_hash text PRIMARY KEY,
    window_started_at timestamptz NOT NULL,
    match_count integer NOT NULL CHECK (match_count >= 0)
);

CREATE TABLE tamashi_reward_accounts (
    account_id text NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    bucket_date date NOT NULL,
    match_count integer NOT NULL CHECK (match_count >= 0),
    PRIMARY KEY (account_id, bucket_date)
);

CREATE INDEX tamashi_ledger_account_idx
    ON tamashi_ledger_entries (account_id, created_at DESC) WHERE account_id IS NOT NULL;
CREATE INDEX tamashi_ledger_match_idx
    ON tamashi_ledger_entries (match_id) WHERE match_id IS NOT NULL;
CREATE UNIQUE INDEX tamashi_ledger_wallet_revision_idx
    ON tamashi_ledger_entries (account_id, wallet_revision) WHERE account_id IS NOT NULL;
CREATE UNIQUE INDEX tamashi_ledger_provider_transaction_idx
    ON tamashi_ledger_entries (provider, provider_transaction_id)
    WHERE provider IS NOT NULL AND provider_transaction_id IS NOT NULL;
CREATE INDEX card_unlocks_account_idx ON card_unlocks (account_id, unlocked_at DESC);
