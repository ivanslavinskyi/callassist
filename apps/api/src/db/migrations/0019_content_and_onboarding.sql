CREATE TABLE content_pages (
  id uuid PRIMARY KEY,
  key varchar(80) NOT NULL UNIQUE CHECK (
    key IN ('privacy', 'terms', 'acceptable_use', 'support', 'faq')
  ),
  page_type varchar(24) NOT NULL CHECK (page_type IN ('page', 'landing')),
  source_locale varchar(8) NOT NULL CHECK (source_locale IN ('en', 'de')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE content_page_localizations (
  id uuid PRIMARY KEY,
  page_id uuid NOT NULL REFERENCES content_pages(id) ON DELETE RESTRICT,
  locale varchar(8) NOT NULL CHECK (locale IN ('en', 'de')),
  slug varchar(120) NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (page_id, locale),
  UNIQUE (locale, slug)
);

CREATE TABLE content_page_revisions (
  id uuid PRIMARY KEY,
  page_id uuid NOT NULL REFERENCES content_pages(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  status varchar(16) NOT NULL CHECK (status IN ('draft', 'published')),
  requires_reacceptance boolean NOT NULL DEFAULT false,
  created_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  UNIQUE (page_id, revision_number),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE INDEX content_page_revisions_published_idx
  ON content_page_revisions(page_id, revision_number DESC)
  WHERE status = 'published';

CREATE TABLE content_page_revision_localizations (
  id uuid PRIMARY KEY,
  revision_id uuid NOT NULL REFERENCES content_page_revisions(id) ON DELETE RESTRICT,
  locale varchar(8) NOT NULL CHECK (locale IN ('en', 'de')),
  title varchar(180) NOT NULL CHECK (btrim(title) <> ''),
  summary text NOT NULL CHECK (btrim(summary) <> ''),
  sections jsonb NOT NULL CHECK (jsonb_typeof(sections) = 'array'),
  seo_title varchar(180) NOT NULL CHECK (btrim(seo_title) <> ''),
  seo_description varchar(500) NOT NULL CHECK (btrim(seo_description) <> ''),
  source_revision_number integer NOT NULL CHECK (source_revision_number > 0),
  created_at timestamptz NOT NULL,
  UNIQUE (revision_id, locale)
);

CREATE TABLE user_onboarding_acceptances (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  terms_revision_id uuid NOT NULL REFERENCES content_page_revisions(id) ON DELETE RESTRICT,
  acceptable_use_revision_id uuid NOT NULL REFERENCES content_page_revisions(id) ON DELETE RESTRICT,
  accepted_locale varchar(8) NOT NULL CHECK (accepted_locale IN ('en', 'de')),
  accepted_terms boolean NOT NULL CHECK (accepted_terms),
  accepted_acceptable_use boolean NOT NULL CHECK (accepted_acceptable_use),
  acknowledged_consent boolean NOT NULL CHECK (acknowledged_consent),
  acknowledged_retention boolean NOT NULL CHECK (acknowledged_retention),
  acknowledged_use_limits boolean NOT NULL CHECK (acknowledged_use_limits),
  acknowledged_credits boolean NOT NULL CHECK (acknowledged_credits),
  accepted_at timestamptz NOT NULL,
  UNIQUE (user_id, terms_revision_id, acceptable_use_revision_id)
);

CREATE INDEX user_onboarding_acceptances_user_time_idx
  ON user_onboarding_acceptances(user_id, accepted_at DESC);

CREATE FUNCTION prevent_onboarding_acceptance_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'user_onboarding_acceptances are immutable';
END;
$$;

CREATE TRIGGER user_onboarding_acceptances_immutable
BEFORE UPDATE OR DELETE ON user_onboarding_acceptances
FOR EACH ROW EXECUTE FUNCTION prevent_onboarding_acceptance_mutation();
