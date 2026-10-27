CREATE TABLE worker_status(worker_id text PRIMARY KEY, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE financial_settings(business_entity_id uuid PRIMARY KEY REFERENCES entities, margin_floor numeric(10,6) NOT NULL CHECK(margin_floor>=0 AND margin_floor<1), approved_by uuid NOT NULL REFERENCES users, source_id uuid NOT NULL REFERENCES sources, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE manual_dispatches(LIKE records_base INCLUDING ALL, object_type text NOT NULL CHECK(object_type IN('quote','message')), object_id uuid NOT NULL, recipient_id uuid NOT NULL REFERENCES contacts, evidence_id uuid NOT NULL REFERENCES sources, occurred_at timestamptz NOT NULL, UNIQUE(object_type,object_id,recipient_id));
CREATE TABLE quote_feedback(LIKE records_base INCLUDING ALL, quote_revision_id uuid NOT NULL REFERENCES quote_revisions, line_index integer NOT NULL CHECK(line_index>=0), response text NOT NULL CHECK(response IN('accepted','negotiating','rejected','needs_model_change')), notes text NOT NULL, source_id uuid NOT NULL REFERENCES sources);
CREATE OR REPLACE FUNCTION validate_entity_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
IF NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.business_entity_id AND organization_id=NEW.organization_id AND is_demo=NEW.is_demo) THEN
 RAISE EXCEPTION 'entity, organization or demo mode mismatch';
END IF;
RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
FOR t IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='organization_id' AND table_name NOT IN('entities','records_base') LOOP
EXECUTE format('CREATE TRIGGER tenant_consistency BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION validate_entity_organization()',t);
END LOOP;
END $$;
