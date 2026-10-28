ALTER TABLE company_portals ADD COLUMN subtitle text NOT NULL DEFAULT '';
UPDATE company_portals SET display_name=v.name, subtitle=v.subtitle
FROM (VALUES (1,'SRR','AI外贸'),(2,'LTMC','目标管理'),(3,'LJYL','AI培训')) AS v(slot,name,subtitle)
WHERE company_portals.slot=v.slot;
UPDATE entities e SET name=c.display_name FROM company_portals c
WHERE c.entity_id=e.id AND c.slot IN (1,2,3);
