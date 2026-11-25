const kernelMembership = (row: string) =>
	`${row}.relationship_schema_slug = 'member-of' and ${row}.relationship_schema_plugin_id is null`;

const changedCollections = {
	insert: `select n.target_entity_id from new_rows n where ${kernelMembership("n")}`,
	delete: `select o.target_entity_id from old_rows o where ${kernelMembership("o")}`,
	update: `select n.target_entity_id from new_rows n join old_rows o on o.id = n.id
		where ${kernelMembership("n")} and o.properties -> 'rank' is distinct from n.properties -> 'rank'`,
};

const referencing = {
	insert: "new table as new_rows",
	delete: "old table as old_rows",
	update: "new table as new_rows old table as old_rows",
};

// Statement triggers advance each changed collection once per statement, so a bulk membership write
// updates the collection row once rather than once per member. PostgreSQL allows transition tables
// only on single-event triggers without a column list.
export const collectionOrderStatements = (["insert", "delete", "update"] as const).flatMap(
	(event) => [
		`create or replace function collection_order_${event}() returns trigger language plpgsql set search_path from current as $$
begin
	update entity set collection_order_revision = collection_order_revision + 1
	where id in (${changedCollections[event]});
	return null;
end $$`,
		`create or replace trigger collection_order_${event} after ${event} on relationship referencing ${referencing[event]} for each statement execute function collection_order_${event}()`,
	],
);
