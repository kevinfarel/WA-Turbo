-- Why a loop closed on its own ("They replied “Terima kasih…” after your reply").
ALTER TABLE loops ADD COLUMN close_note text;

-- Partners are now whatever you type in the tag dialog; no built-in list or fixed types.
ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_type_check;
ALTER TABLE partners ALTER COLUMN service SET DEFAULT '';
ALTER TABLE partners ALTER COLUMN steps SET DEFAULT '{}';
-- Drop the built-in list earlier versions shipped, unless a chat is tagged with one.
DELETE FROM partners p
 WHERE p.type IN ('Bank', 'KYC', 'e-Sign', 'Switching') AND cardinality(p.steps) = 5
   AND NOT EXISTS (SELECT 1 FROM chats c WHERE c.partner_id = p.id);
