CREATE FUNCTION prevent_published_content_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'published content revisions are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER published_content_revisions_immutable
BEFORE UPDATE OR DELETE ON content_page_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_published_content_revision_mutation();

CREATE FUNCTION prevent_published_content_localization_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM content_page_revisions
    WHERE id = OLD.revision_id AND status = 'published'
  ) THEN
    RAISE EXCEPTION 'published content revision localizations are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER published_content_revision_localizations_immutable
BEFORE UPDATE OR DELETE ON content_page_revision_localizations
FOR EACH ROW EXECUTE FUNCTION prevent_published_content_localization_mutation();
