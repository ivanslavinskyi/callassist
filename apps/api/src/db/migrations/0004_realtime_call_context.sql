ALTER TABLE call_briefs
  ADD COLUMN agent_name text NOT NULL DEFAULT 'Sebastian',
  ADD COLUMN represented_person text NOT NULL DEFAULT 'Ivan Slavinskyi',
  ADD COLUMN speech_impairment_disclosure text NOT NULL DEFAULT
    'Herr Slavinskyi ist aufgrund einer Sprechbehinderung beim Telefonieren eingeschränkt und nutzt mich deshalb, um Gespräche in seinem Auftrag zu führen.',
  ADD COLUMN context_ciphertext text;
