CREATE TABLE goals(
  LIKE records_base INCLUDING ALL,
  parent_id uuid,
  level text NOT NULL CHECK(level IN ('quarter','month','ten_day')),
  year integer NOT NULL CHECK(year BETWEEN 2000 AND 2200),
  quarter integer NOT NULL CHECK(quarter BETWEEN 1 AND 4),
  month integer CHECK(month BETWEEN 1 AND 12),
  ten_day integer CHECK(ten_day BETWEEN 1 AND 3),
  title text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users,
  status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','in_progress','completed','cancelled')),
  result_note text NOT NULL DEFAULT '',
  UNIQUE(id,business_entity_id),
  FOREIGN KEY(parent_id,business_entity_id) REFERENCES goals(id,business_entity_id),
  CHECK((level='quarter' AND parent_id IS NULL AND month IS NULL AND ten_day IS NULL) OR (level='month' AND parent_id IS NOT NULL AND month IS NOT NULL AND ten_day IS NULL) OR (level='ten_day' AND parent_id IS NOT NULL AND month IS NOT NULL AND ten_day IS NOT NULL)),
  CHECK(month IS NULL OR (month-1)/3+1=quarter)
);
CREATE INDEX goals_company_period ON goals(business_entity_id,year,quarter,owner_id);
