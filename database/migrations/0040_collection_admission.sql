-- A source observation is a baseline; only admitted changes consume collection slots.
CREATE TABLE collection_observations (
  source_id text NOT NULL REFERENCES sources(id),
  identity_key text NOT NULL,
  fingerprint text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id,identity_key)
);
CREATE TABLE collection_admissions (
  id bigserial PRIMARY KEY,
  source_id text NOT NULL REFERENCES sources(id),
  article_id text NOT NULL REFERENCES articles(id),
  input_revision integer NOT NULL,
  admitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id,input_revision)
);
CREATE INDEX collection_admissions_time ON collection_admissions(admitted_at);
CREATE INDEX collection_admissions_source_time ON collection_admissions(source_id,admitted_at);
