-- The language Claude writes in for each linked number (summaries, SUM UP! cards, report overviews).
-- NULL until it is picked, or detected from the number's first conversations once Claude is connected.
ALTER TABLE accounts ADD COLUMN ai_lang text CHECK (ai_lang IN ('en', 'id'));
ALTER TABLE accounts ADD COLUMN ai_lang_detected boolean NOT NULL DEFAULT false;

-- A cached summary is only reused in the language it was written in. Older rows were written in English.
ALTER TABLE summaries ADD COLUMN lang text NOT NULL DEFAULT 'en';
