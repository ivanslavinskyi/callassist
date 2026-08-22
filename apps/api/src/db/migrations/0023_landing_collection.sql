ALTER TABLE content_editorial_collections
  DROP CONSTRAINT content_editorial_collections_key_check;

ALTER TABLE content_editorial_collections
  ADD CONSTRAINT content_editorial_collections_key_check
  CHECK (key IN ('faq', 'navigation', 'landing'));
