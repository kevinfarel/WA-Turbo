-- Pinned chats (local to this Mac; WhatsApp's own pins are never touched).
ALTER TABLE chats ADD COLUMN pinned_at timestamptz;

-- Cache: every new, edited or deleted message bumps the chat's revision. A summary remembers the
-- revision and window it read, so an unchanged chat is never sent to Claude again.
ALTER TABLE chats ADD COLUMN rev bigint NOT NULL DEFAULT 0;
ALTER TABLE summaries ADD COLUMN chat_rev bigint;
ALTER TABLE summaries ADD COLUMN window_key text;
ALTER TABLE summaries ADD COLUMN auto boolean NOT NULL DEFAULT false;

-- Auto summary: when the scheduler last looked at a chat and which revision it covered.
ALTER TABLE chats ADD COLUMN auto_checked_at timestamptz;
ALTER TABLE chats ADD COLUMN auto_rev bigint;

-- The Summarize window default changed from 300 messages to this week.
DELETE FROM settings WHERE key = 'window';
