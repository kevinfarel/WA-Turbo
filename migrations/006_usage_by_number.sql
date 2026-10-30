-- Claude usage per number: each run remembers the chat (and so the number) it read.
-- Report overviews read several numbers at once and keep both NULL.
ALTER TABLE ai_runs ADD COLUMN chat_id text REFERENCES chats(id) ON DELETE SET NULL;
ALTER TABLE ai_runs ADD COLUMN account_id text REFERENCES accounts(id) ON DELETE SET NULL;
CREATE INDEX ai_runs_time ON ai_runs (created_at);

-- Earlier runs: match each to the summary saved right after it, or to the chat auto summary checked right after it.
UPDATE ai_runs r SET chat_id = m.chat_id
  FROM (
    SELECT r2.id, coalesce(
      (SELECT s.chat_id FROM summaries s WHERE s.created_at BETWEEN r2.created_at - interval '2 seconds' AND r2.created_at + interval '30 seconds'
        ORDER BY abs(extract(epoch FROM s.created_at - r2.created_at)) LIMIT 1),
      (SELECT c.id FROM chats c WHERE c.auto_checked_at BETWEEN r2.created_at AND r2.created_at + interval '60 seconds'
        ORDER BY c.auto_checked_at LIMIT 1)) AS chat_id
    FROM ai_runs r2 WHERE r2.kind <> 'report'
  ) m
 WHERE r.id = m.id AND m.chat_id IS NOT NULL;
UPDATE ai_runs r SET account_id = c.account_id FROM chats c WHERE c.id = r.chat_id;
