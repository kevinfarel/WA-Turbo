-- "My team": people on your side in group chats. Their asks are "waiting on them", their answers count as yours.
-- One person can have two IDs (phone number and LID), so IDs hang off a member row.
CREATE TABLE team_members (
  id         bigserial PRIMARY KEY,
  name       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE team_jids (
  jid       text PRIMARY KEY,
  member_id bigint NOT NULL REFERENCES team_members(id) ON DELETE CASCADE
);

-- Group messages from history sync were stored with an empty sender; NULL means "not known".
UPDATE messages SET sender_jid = NULL WHERE sender_jid = '';
CREATE INDEX messages_sender ON messages (sender_jid) WHERE sender_jid IS NOT NULL;
