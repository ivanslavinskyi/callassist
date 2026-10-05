-- Preserve existing behaviour until the operator explicitly enables the setting.
-- Production rollout enables it immediately through the audited registration policy.
UPDATE beta_controls
SET settings = jsonb_set(settings, '{registration,swissPhonesOnly}', 'false'::jsonb)
WHERE settings->'registration' IS NOT NULL
  AND NOT (settings->'registration' ? 'swissPhonesOnly');
