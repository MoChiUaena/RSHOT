-- Human selection labels are private admin data, separate from published articles and model scores.
CREATE TABLE calibration_batches (
  id text PRIMARY KEY,
  label text NOT NULL,
  input_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE calibration_cases (
  batch_id text NOT NULL REFERENCES calibration_batches(id),
  case_id text NOT NULL,
  position integer NOT NULL,
  input jsonb NOT NULL,
  decision text CHECK (decision IN ('select','reject','either')),
  notes text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 0,
  labelled_at timestamptz,
  labelled_by text,
  PRIMARY KEY (batch_id,case_id),
  UNIQUE (batch_id,position)
);
