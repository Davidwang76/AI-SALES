DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['sources','market_tasks','activities','activity_costs','accounts','contacts','leads','touches','facts','assessments','tasks','opportunities','knowledge','contents','channel_accounts','conversations','messages','enrollments','rfqs','discovery_runs','candidates','jobs','work_logs','feedback','products','suppliers','purchase_rfqs','supplier_responses','quotes','quote_revisions','orders','shipments','receipts','allocations','credit_policies','credit_exposures'] LOOP
EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY(business_entity_id) REFERENCES entities(id)',t);
EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY(organization_id) REFERENCES organizations(id)',t);
EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY(created_by) REFERENCES users(id)',t);
END LOOP; END $$;
CREATE INDEX contacts_email ON contacts(business_entity_id,lower(email));
CREATE INDEX source_owner ON sources(business_entity_id,created_by);
