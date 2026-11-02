-- People tagged in a message: the "@<number>" written in its text → the person's ID ('me' for you),
-- so the chat and the AI read "@Name" instead of a number. NULL when nobody is tagged.
ALTER TABLE messages ADD COLUMN mentions jsonb;
