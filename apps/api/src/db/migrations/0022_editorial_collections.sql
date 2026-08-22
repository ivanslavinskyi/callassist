CREATE TABLE content_editorial_collections (
  id uuid PRIMARY KEY,
  key varchar(32) NOT NULL UNIQUE CHECK (key IN ('faq', 'navigation')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE content_editorial_revisions (
  id uuid PRIMARY KEY,
  collection_id uuid NOT NULL
    REFERENCES content_editorial_collections(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  status varchar(16) NOT NULL CHECK (status IN ('draft', 'published')),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'array'),
  created_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  published_at timestamptz,
  UNIQUE (collection_id, revision_number),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE UNIQUE INDEX content_editorial_revisions_one_draft_idx
  ON content_editorial_revisions(collection_id)
  WHERE status = 'draft';

CREATE INDEX content_editorial_revisions_published_idx
  ON content_editorial_revisions(collection_id, revision_number DESC)
  WHERE status = 'published';

CREATE TABLE content_editorial_admin_events (
  id uuid PRIMARY KEY,
  event_type varchar(64) NOT NULL CHECK (
    event_type IN (
      'editorial.draft_created',
      'editorial.draft_updated',
      'editorial.revision_published',
      'editorial.rollback_draft_created'
    )
  ),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  collection_id uuid NOT NULL
    REFERENCES content_editorial_collections(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL
    REFERENCES content_editorial_revisions(id) ON DELETE RESTRICT,
  source_revision_id uuid
    REFERENCES content_editorial_revisions(id) ON DELETE RESTRICT,
  reason text CHECK (
    reason IS NULL OR char_length(btrim(reason)) BETWEEN 3 AND 500
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX content_editorial_admin_events_collection_created_at_idx
  ON content_editorial_admin_events(collection_id, created_at DESC);

CREATE FUNCTION prevent_published_editorial_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'published editorial revisions are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER content_editorial_revisions_immutable
BEFORE UPDATE OR DELETE ON content_editorial_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_published_editorial_revision_mutation();

CREATE TRIGGER content_editorial_admin_events_immutable
BEFORE UPDATE OR DELETE ON content_editorial_admin_events
FOR EACH ROW EXECUTE FUNCTION prevent_content_admin_event_mutation();
