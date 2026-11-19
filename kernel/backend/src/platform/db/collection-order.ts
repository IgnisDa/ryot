export const collectionOrderStatements = [
	`create or replace function collection_order_changed() returns trigger language plpgsql set search_path from current as $$
begin
	if tg_op = 'DELETE' then
		if old.relationship_schema_slug = 'member-of' and old.relationship_schema_plugin_id is null then
			update entity set collection_order_revision = collection_order_revision + 1 where id = old.target_entity_id;
		end if;
	elsif new.relationship_schema_slug = 'member-of' and new.relationship_schema_plugin_id is null then
		if tg_op = 'INSERT' or old.properties -> 'rank' is distinct from new.properties -> 'rank' then
			update entity set collection_order_revision = collection_order_revision + 1 where id = new.target_entity_id;
		end if;
	end if;
	return null;
end $$`,
	`create or replace trigger collection_order_changed after insert or delete or update of properties on relationship for each row execute function collection_order_changed()`,
];
