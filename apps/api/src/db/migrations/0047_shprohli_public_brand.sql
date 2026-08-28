-- Publish brand-only copies of existing CMS content without invalidating legal
-- acceptances tied to the earlier reacceptance-required revisions.
INSERT INTO content_page_revisions (
  id,
  page_id,
  revision_number,
  status,
  requires_reacceptance,
  created_by_user_id,
  created_at,
  updated_at,
  published_at
)
SELECT
  overlay(
    overlay(md5(page.id::text || ':shprohli-public-brand') placing '4' from 13)
    placing '8' from 17
  )::uuid,
  page.id,
  next_revision.number,
  'published',
  false,
  NULL,
  TIMESTAMPTZ '2026-08-28 00:00:00+02',
  TIMESTAMPTZ '2026-08-28 00:00:00+02',
  TIMESTAMPTZ '2026-08-28 00:00:00+02'
FROM content_pages page
JOIN LATERAL (
  SELECT revision_number
  FROM content_page_revisions candidate
  WHERE candidate.page_id = page.id
    AND candidate.status = 'published'
  ORDER BY candidate.revision_number DESC
  LIMIT 1
) latest ON true
JOIN LATERAL (
  SELECT max(candidate.revision_number) + 1 AS number
  FROM content_page_revisions candidate
  WHERE candidate.page_id = page.id
) next_revision ON true
ON CONFLICT (id) DO NOTHING;

INSERT INTO content_page_revision_localizations (
  id,
  revision_id,
  locale,
  title,
  summary,
  sections,
  seo_title,
  seo_description,
  source_revision_number,
  created_at,
  updated_at
)
SELECT
  overlay(
    overlay(md5(target.id::text || ':' || source_localization.locale) placing '4' from 13)
    placing '8' from 17
  )::uuid,
  target.id,
  source_localization.locale,
  replace(replace(replace(source_localization.title, 'CallAssist', 'SHPROHLI'), 'Callassist', 'SHPROHLI'), 'CALLASSIST', 'SHPROHLI'),
  replace(replace(replace(source_localization.summary, 'CallAssist', 'SHPROHLI'), 'Callassist', 'SHPROHLI'), 'CALLASSIST', 'SHPROHLI'),
  replace(replace(replace(source_localization.sections::text, 'CallAssist', 'SHPROHLI'), 'Callassist', 'SHPROHLI'), 'CALLASSIST', 'SHPROHLI')::jsonb,
  replace(replace(replace(source_localization.seo_title, 'CallAssist', 'SHPROHLI'), 'Callassist', 'SHPROHLI'), 'CALLASSIST', 'SHPROHLI'),
  replace(replace(replace(source_localization.seo_description, 'CallAssist', 'SHPROHLI'), 'Callassist', 'SHPROHLI'), 'CALLASSIST', 'SHPROHLI'),
  target.revision_number,
  TIMESTAMPTZ '2026-08-28 00:00:00+02',
  TIMESTAMPTZ '2026-08-28 00:00:00+02'
FROM content_pages page
JOIN content_page_revisions target
  ON target.id = overlay(
    overlay(md5(page.id::text || ':shprohli-public-brand') placing '4' from 13)
    placing '8' from 17
  )::uuid
JOIN LATERAL (
  SELECT id
  FROM content_page_revisions candidate
  WHERE candidate.page_id = page.id
    AND candidate.status = 'published'
    AND candidate.revision_number < target.revision_number
  ORDER BY candidate.revision_number DESC
  LIMIT 1
) source_revision ON true
JOIN content_page_revision_localizations source_localization
  ON source_localization.revision_id = source_revision.id
ON CONFLICT (id) DO NOTHING;

INSERT INTO content_editorial_revisions (
  id,
  collection_id,
  revision_number,
  status,
  snapshot,
  created_by_user_id,
  created_at,
  updated_at,
  published_at
)
SELECT
  overlay(
    overlay(md5(collection.id::text || ':shprohli-public-brand') placing '4' from 13)
    placing '8' from 17
  )::uuid,
  collection.id,
  next_revision.number,
  'published',
  replace(replace(replace(latest.snapshot::text, 'CallAssist', 'SHPROHLI'), 'Callassist', 'SHPROHLI'), 'CALLASSIST', 'SHPROHLI')::jsonb,
  NULL,
  TIMESTAMPTZ '2026-08-28 00:00:00+02',
  TIMESTAMPTZ '2026-08-28 00:00:00+02',
  TIMESTAMPTZ '2026-08-28 00:00:00+02'
FROM content_editorial_collections collection
JOIN LATERAL (
  SELECT revision_number, snapshot
  FROM content_editorial_revisions candidate
  WHERE candidate.collection_id = collection.id
    AND candidate.status = 'published'
  ORDER BY candidate.revision_number DESC
  LIMIT 1
) latest ON true
JOIN LATERAL (
  SELECT max(candidate.revision_number) + 1 AS number
  FROM content_editorial_revisions candidate
  WHERE candidate.collection_id = collection.id
) next_revision ON true
WHERE collection.key IN ('faq', 'landing')
ON CONFLICT (id) DO NOTHING;
