ALTER TABLE call_briefs
ADD COLUMN voice_gender varchar(16) NOT NULL DEFAULT 'male';

ALTER TABLE call_briefs
ADD CONSTRAINT call_briefs_voice_gender_check
CHECK (voice_gender IN ('male', 'female'));
