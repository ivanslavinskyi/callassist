CREATE TABLE call_preparation_language_contexts (
  preparation_id uuid PRIMARY KEY REFERENCES call_preparation_requests(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL,
  account_preference varchar(35),
  request_version integer NOT NULL DEFAULT 2 CHECK (request_version = 2)
);

CREATE TABLE call_language_contexts (
  call_brief_id uuid PRIMARY KEY REFERENCES call_briefs(id) ON DELETE CASCADE,
  context jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
