CREATE TABLE home_og_assets (
  hash text PRIMARY KEY CHECK (hash ~ '^[a-f0-9]{64}$'),
  png bytea NOT NULL CHECK (octet_length(png) BETWEEN 1 AND 5242880),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE home_og_versions (
  id uuid PRIMARY KEY,
  locale text NOT NULL,
  asset_hash text NOT NULL REFERENCES home_og_assets(hash),
  source text NOT NULL CHECK (source IN ('generated', 'uploaded')),
  slogan text,
  alt text NOT NULL,
  template_version text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ever_published boolean NOT NULL DEFAULT false,
  UNIQUE(locale, id)
);
CREATE INDEX home_og_versions_locale_created ON home_og_versions(locale, created_at DESC);
CREATE TABLE home_og_locales (
  locale text PRIMARY KEY,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  published_id uuid,
  previous_id uuid,
  draft_id uuid,
  FOREIGN KEY (locale, published_id) REFERENCES home_og_versions(locale, id),
  FOREIGN KEY (locale, previous_id) REFERENCES home_og_versions(locale, id),
  FOREIGN KEY (locale, draft_id) REFERENCES home_og_versions(locale, id)
);
CREATE TABLE home_og_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  locale text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('draft', 'publish')),
  version_id uuid NOT NULL REFERENCES home_og_versions(id),
  previous_version_id uuid REFERENCES home_og_versions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
