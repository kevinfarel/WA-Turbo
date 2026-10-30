-- Notifications: a per-chat mute that lives only in WA Turbo (your phone's mute is separate).
-- NULL = not muted; 'infinity' = until you unmute.
ALTER TABLE chats ADD COLUMN notify_muted_until timestamptz;
