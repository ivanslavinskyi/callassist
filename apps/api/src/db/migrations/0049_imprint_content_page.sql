ALTER TABLE content_pages
  DROP CONSTRAINT content_pages_key_check;

ALTER TABLE content_pages
  ADD CONSTRAINT content_pages_key_check CHECK (
    key IN ('privacy', 'terms', 'acceptable_use', 'support', 'faq', 'imprint')
  );

-- The content initializer publishes the corresponding immutable revisions with
-- stable IDs. On an existing database it selects MAX(revision_number) + 1 and
-- keeps the public-copy upgrade non-reaccepting; on a fresh database it creates
-- the initial legal acceptance anchors.
