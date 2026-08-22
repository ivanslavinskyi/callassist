ALTER TABLE system_controls
ADD CONSTRAINT system_controls_reason_length_check CHECK (
  char_length(btrim(reason)) BETWEEN 1 AND 500
);
