ALTER TABLE content_page_revisions
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE content_page_revisions
  ALTER COLUMN updated_at DROP DEFAULT;

ALTER TABLE content_page_revision_localizations
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE content_page_revision_localizations
  ALTER COLUMN updated_at DROP DEFAULT;

CREATE UNIQUE INDEX content_page_revisions_one_draft_idx
  ON content_page_revisions(page_id)
  WHERE status = 'draft';

CREATE TABLE content_admin_events (
  id uuid PRIMARY KEY,
  event_type varchar(64) NOT NULL CHECK (
    event_type IN (
      'content.draft_created',
      'content.draft_updated',
      'content.revision_published',
      'content.rollback_draft_created'
    )
  ),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  page_id uuid NOT NULL REFERENCES content_pages(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL REFERENCES content_page_revisions(id) ON DELETE RESTRICT,
  source_revision_id uuid REFERENCES content_page_revisions(id) ON DELETE RESTRICT,
  locale varchar(8) CHECK (locale IN ('en', 'de')),
  reason text CHECK (
    reason IS NULL OR char_length(btrim(reason)) BETWEEN 3 AND 500
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX content_admin_events_page_created_at_idx
  ON content_admin_events(page_id, created_at DESC);

CREATE INDEX content_admin_events_actor_created_at_idx
  ON content_admin_events(actor_user_id, created_at DESC);

CREATE FUNCTION prevent_content_admin_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'content_admin_events are immutable';
END;
$$;

CREATE TRIGGER content_admin_events_immutable
BEFORE UPDATE OR DELETE ON content_admin_events
FOR EACH ROW EXECUTE FUNCTION prevent_content_admin_event_mutation();
