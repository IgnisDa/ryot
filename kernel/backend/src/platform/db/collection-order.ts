import { statementTriggers } from "./statement-triggers";

const kernelMembership = (row: string) =>
	`${row}.relationship_schema_slug = 'member-of' and ${row}.relationship_schema_plugin_id is null`;

const changedCollections = {
	insert: `select n.target_entity_id from new_rows n where ${kernelMembership("n")}`,
	delete: `select o.target_entity_id from old_rows o where ${kernelMembership("o")}`,
	update: `select n.target_entity_id from new_rows n join old_rows o on o.id = n.id
		where ${kernelMembership("n")} and o.properties -> 'rank' is distinct from n.properties -> 'rank'`,
};

// Statement triggers advance each changed collection once per statement, so a bulk membership write
// updates the collection row once rather than once per member.
export const collectionOrderStatements = statementTriggers({
	tables: ["relationship"],
	trigger: "collection_order",
	function: "collection_order",
	body: ({ event }) => `update entity set collection_order_revision = collection_order_revision + 1
	where id in (${changedCollections[event]})`,
});
