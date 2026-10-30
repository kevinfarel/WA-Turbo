-- WA Turbo schema. Every table that holds WhatsApp data is keyed by account,
-- so one number's data never shows up under another.

CREATE TABLE accounts (
  id          text PRIMARY KEY DEFAULT md5(random()::text || clock_timestamp()::text),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  phone       text NOT NULL DEFAULT '',
  jid         text,
  accent      text NOT NULL DEFAULT 'green',
  status      text NOT NULL DEFAULT 'pairing'
              CHECK (status IN ('pairing', 'online', 'reconnecting', 'logged_out')),
  paired_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Baileys credentials ('creds', '') and signal keys (category, id), per account.
CREATE TABLE wa_auth_state (
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  key_id     text NOT NULL,
  value      jsonb NOT NULL,
  PRIMARY KEY (account_id, kind, key_id)
);

CREATE TABLE contacts (
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  jid        text NOT NULL,
  lid        text,
  phone      text,
  name       text,
  notify     text,
  PRIMARY KEY (account_id, jid)
);
CREATE INDEX contacts_lid ON contacts (account_id, lid);

CREATE TABLE partners (
  id           text PRIMARY KEY,
  type         text NOT NULL CHECK (type IN ('Bank', 'KYC', 'e-Sign', 'Switching')),
  service      text NOT NULL,
  steps        text[] NOT NULL,
  current_step int NOT NULL DEFAULT 0
);

CREATE TABLE chats (
  id              text PRIMARY KEY DEFAULT md5(random()::text || clock_timestamp()::text),
  account_id      text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  jid             text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('dm', 'group')),
  name            text NOT NULL DEFAULT '',
  subtitle        text NOT NULL DEFAULT '',
  unread          int NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  partner_id      text REFERENCES partners(id) ON DELETE SET NULL,
  service         text,
  stage           text,
  summarized_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, jid)
);
CREATE INDEX chats_recent ON chats (account_id, last_message_at DESC NULLS LAST);

CREATE TABLE messages (
  id           bigserial PRIMARY KEY,
  account_id   text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  chat_id      text NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  wa_id        text NOT NULL,
  sender_jid   text,
  sender_name  text,
  from_me      boolean NOT NULL DEFAULT false,
  sent_at      timestamptz NOT NULL,
  type         text NOT NULL DEFAULT 'text',
  text         text NOT NULL DEFAULT '',
  quoted_wa_id text,
  quoted_from_me boolean NOT NULL DEFAULT false,
  mentions_me  boolean NOT NULL DEFAULT false,
  media        jsonb,
  raw          jsonb,
  edited       boolean NOT NULL DEFAULT false,
  deleted      boolean NOT NULL DEFAULT false,
  tsv          tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(text, ''))) STORED,
  UNIQUE (chat_id, wa_id)
);
CREATE INDEX messages_chat_time ON messages (chat_id, sent_at DESC);
CREATE INDEX messages_tsv ON messages USING gin (tsv);

CREATE TABLE loops (
  id          bigserial PRIMARY KEY,
  chat_id     text NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id  bigint REFERENCES messages(id) ON DELETE SET NULL,
  dir         text NOT NULL CHECK (dir IN ('owed', 'waiting')),
  kind        text NOT NULL CHECK (kind IN ('question', 'confirmation', 'commitment')),
  state       text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'answered', 'snoozed', 'dismissed')),
  source      text NOT NULL CHECK (source IN ('manual', 'rule', 'ai')),
  topic       text NOT NULL,
  asked_by    text NOT NULL,
  asked_at    timestamptz NOT NULL,
  sla_hours   int NOT NULL,
  blocks      text,
  snooze_note text,
  answered_at timestamptz,
  ai_hint     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, dir)
);
CREATE INDEX loops_open ON loops (state, chat_id);

CREATE TABLE loop_nudges (
  id         bigserial PRIMARY KEY,
  loop_id    bigint NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
  at         timestamptz NOT NULL DEFAULT now(),
  by_me      boolean NOT NULL,
  message_id bigint REFERENCES messages(id) ON DELETE SET NULL
);

CREATE TABLE summaries (
  id              bigserial PRIMARY KEY,
  chat_id         text NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  model           text NOT NULL,
  window_size     int NOT NULL,
  last_message_id bigint,
  msg_count       int NOT NULL,
  result          jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX summaries_chat ON summaries (chat_id, created_at DESC);

CREATE TABLE reports (
  id            bigserial PRIMARY KEY,
  title         text NOT NULL,
  preset        text NOT NULL,
  custom_prompt text NOT NULL DEFAULT '',
  days          text NOT NULL,
  chat_ids      text[] NOT NULL,
  loop_ids      text[] NOT NULL DEFAULT '{}',
  model         text NOT NULL,
  overview      text NOT NULL DEFAULT '',
  insights      jsonb NOT NULL DEFAULT '{}',
  stats         jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE aliases (
  real  text PRIMARY KEY,
  alias text NOT NULL UNIQUE
);

CREATE TABLE ai_runs (
  id                 bigserial PRIMARY KEY,
  kind               text NOT NULL,
  model              text NOT NULL,
  input_tokens       int,
  output_tokens      int,
  cache_read_tokens  int,
  cache_write_tokens int,
  stop_reason        text,
  duration_ms        int,
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
