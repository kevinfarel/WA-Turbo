-- Words a number must never mention, checked before a message goes out. Off until switched on for that number.
ALTER TABLE accounts ADD COLUMN restricted_on boolean NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN restricted_hard boolean NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN restricted_words text[] NOT NULL DEFAULT '{}';
