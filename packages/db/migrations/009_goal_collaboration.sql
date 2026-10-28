CREATE TABLE goal_plans (
 LIKE records_base INCLUDING ALL,
 parent_id uuid,
 parent_revision_id uuid,
 predecessor_id uuid,
 level text NOT NULL CHECK(level IN ('quarter','month','ten_day')),
 year integer NOT NULL CHECK(year BETWEEN 2000 AND 2200),
 quarter integer NOT NULL CHECK(quarter BETWEEN 1 AND 4),
 month integer CHECK(month BETWEEN 1 AND 12),
 ten_day integer CHECK(ten_day BETWEEN 1 AND 3),
 title text NOT NULL,
 superior_id uuid NOT NULL REFERENCES users,
 subordinate_id uuid NOT NULL REFERENCES users,
 secretary_id uuid NOT NULL REFERENCES users,
 workflow text NOT NULL DEFAULT 'discussion' CHECK(workflow IN ('discussion','drafting','awaiting_superior','awaiting_subordinate','awaiting_secretary','confirmed')),
 context_version integer NOT NULL DEFAULT 1,
 excluded_material_ids uuid[] NOT NULL DEFAULT '{}',
 current_revision_id uuid,
 confirmed_revision_id uuid,
 UNIQUE(id,business_entity_id),
 FOREIGN KEY(parent_id,business_entity_id) REFERENCES goal_plans(id,business_entity_id),
 FOREIGN KEY(predecessor_id,business_entity_id) REFERENCES goal_plans(id,business_entity_id),
 CHECK(superior_id<>subordinate_id AND superior_id<>secretary_id AND subordinate_id<>secretary_id),
 CHECK((level='quarter' AND parent_id IS NULL AND month IS NULL AND ten_day IS NULL) OR (level='month' AND parent_id IS NOT NULL AND month IS NOT NULL AND ten_day IS NULL) OR (level='ten_day' AND parent_id IS NOT NULL AND month IS NOT NULL AND ten_day IS NOT NULL)),
 CHECK(month IS NULL OR (month-1)/3+1=quarter),
 UNIQUE NULLS NOT DISTINCT(business_entity_id,level,year,quarter,month,ten_day,superior_id,subordinate_id,secretary_id)
);
CREATE UNIQUE INDEX goal_successor_unique ON goal_plans(predecessor_id) WHERE predecessor_id IS NOT NULL;
CREATE TABLE goal_messages (
 LIKE records_base INCLUDING ALL,
 plan_id uuid NOT NULL,
 voice text NOT NULL CHECK(voice IN ('superior','subordinate','secretary')),
 content text NOT NULL,
 FOREIGN KEY(plan_id,business_entity_id) REFERENCES goal_plans(id,business_entity_id)
);
CREATE TABLE goal_materials (
 LIKE records_base INCLUDING ALL,
 plan_id uuid NOT NULL,
 source_id uuid REFERENCES sources,
 title text NOT NULL,
 content text NOT NULL DEFAULT '',
 FOREIGN KEY(plan_id,business_entity_id) REFERENCES goal_plans(id,business_entity_id)
);
CREATE TABLE goal_reviews (
 LIKE records_base INCLUDING ALL,
 plan_id uuid NOT NULL,
 confirmed_revision_id uuid NOT NULL,
 results text NOT NULL,
 adjustments text NOT NULL,
 FOREIGN KEY(plan_id,business_entity_id) REFERENCES goal_plans(id,business_entity_id)
);
CREATE TABLE goal_revisions (
 LIKE records_base INCLUDING ALL,
 plan_id uuid NOT NULL,
 revision integer NOT NULL,
 context_version integer NOT NULL,
 input_snapshot jsonb NOT NULL,
 proposal text NOT NULL,
 evidence jsonb NOT NULL,
 unknowns jsonb NOT NULL,
 risks jsonb NOT NULL,
 origin text NOT NULL CHECK(origin IN ('model','human_edit')),
 model text,
 UNIQUE(plan_id,revision),
 FOREIGN KEY(plan_id,business_entity_id) REFERENCES goal_plans(id,business_entity_id)
);
ALTER TABLE goal_plans ADD FOREIGN KEY(current_revision_id) REFERENCES goal_revisions;
ALTER TABLE goal_plans ADD FOREIGN KEY(confirmed_revision_id) REFERENCES goal_revisions;
ALTER TABLE goal_plans ADD FOREIGN KEY(parent_revision_id) REFERENCES goal_revisions;
ALTER TABLE goal_reviews ADD FOREIGN KEY(confirmed_revision_id) REFERENCES goal_revisions;
CREATE TABLE goal_confirmations (
 LIKE records_base INCLUDING ALL,
 plan_id uuid NOT NULL,
 revision_id uuid NOT NULL REFERENCES goal_revisions,
 voice text NOT NULL CHECK(voice IN ('superior','subordinate','secretary')),
 note text NOT NULL DEFAULT '',
 UNIQUE(revision_id,voice),
 FOREIGN KEY(plan_id,business_entity_id) REFERENCES goal_plans(id,business_entity_id)
);
CREATE TABLE goal_draft_jobs (
 LIKE records_base INCLUDING ALL,
 plan_id uuid NOT NULL,
 context_version integer NOT NULL,
 input_snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','stale','needs_manual')),
 error text,
 locked_at timestamptz,
 finished_at timestamptz,
 model text,
 usage jsonb,
 FOREIGN KEY(plan_id,business_entity_id) REFERENCES goal_plans(id,business_entity_id)
);
CREATE UNIQUE INDEX goal_draft_active ON goal_draft_jobs(plan_id) WHERE status IN ('queued','running');
CREATE TRIGGER goal_message_immutable BEFORE UPDATE OR DELETE ON goal_messages FOR EACH ROW EXECUTE FUNCTION prevent_audit_change();
CREATE TRIGGER goal_material_immutable BEFORE UPDATE OR DELETE ON goal_materials FOR EACH ROW EXECUTE FUNCTION prevent_audit_change();
CREATE TRIGGER goal_revision_immutable BEFORE UPDATE OR DELETE ON goal_revisions FOR EACH ROW EXECUTE FUNCTION prevent_audit_change();
CREATE TRIGGER goal_confirmation_immutable BEFORE UPDATE OR DELETE ON goal_confirmations FOR EACH ROW EXECUTE FUNCTION prevent_audit_change();
CREATE TRIGGER goal_review_immutable BEFORE UPDATE OR DELETE ON goal_reviews FOR EACH ROW EXECUTE FUNCTION prevent_audit_change();
CREATE INDEX goal_plan_company ON goal_plans(business_entity_id,year,quarter);
CREATE INDEX goal_messages_plan ON goal_messages(plan_id,created_at);
CREATE INDEX goal_materials_plan ON goal_materials(plan_id,created_at);
CREATE INDEX goal_reviews_plan ON goal_reviews(plan_id,created_at);
CREATE INDEX goal_revisions_plan ON goal_revisions(plan_id,created_at);
CREATE INDEX goal_confirmations_plan ON goal_confirmations(plan_id,created_at);
CREATE INDEX goal_draft_jobs_plan ON goal_draft_jobs(plan_id,created_at);
CREATE INDEX goal_draft_queue ON goal_draft_jobs(status,created_at);
