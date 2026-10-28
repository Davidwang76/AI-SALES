ALTER TABLE users ADD COLUMN login_username text;
CREATE UNIQUE INDEX users_login_username_unique ON users(lower(login_username)) WHERE login_username IS NOT NULL;
CREATE TABLE company_portals (
  slot integer PRIMARY KEY CHECK(slot BETWEEN 1 AND 9),
  display_name text NOT NULL DEFAULT '',
  entity_id uuid UNIQUE REFERENCES entities
);
INSERT INTO company_portals(slot) SELECT generate_series(1,9);
ALTER TABLE entities ADD COLUMN workspace_config jsonb;
