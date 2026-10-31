-- Names from your phone's contacts, imported as a .vcf file. One address book for every linked number,
-- keyed by the international number in digits (6281234567890).
CREATE TABLE phonebook (
  phone      text PRIMARY KEY,
  name       text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The name to show for a WhatsApp ID: your imported contact first, then the name saved on the phone that owns
-- the number (WhatsApp syncs it). NULL when neither exists; callers fall back to the profile name or number.
-- acct NULL looks across every linked number.
CREATE FUNCTION contact_name(acct text, who text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT p.name FROM phonebook p WHERE p.phone = coalesce(
       CASE WHEN who LIKE '%@s.whatsapp.net' THEN split_part(who, '@', 1) END,
       (SELECT regexp_replace(ct.phone, '\D', '', 'g') FROM contacts ct
         WHERE (acct IS NULL OR ct.account_id = acct) AND ct.lid = who AND ct.phone IS NOT NULL LIMIT 1))),
    (SELECT ct.name FROM contacts ct
      WHERE (acct IS NULL OR ct.account_id = acct) AND (ct.jid = who OR ct.lid = who) AND coalesce(ct.name, '') <> '' LIMIT 1))
$$;
