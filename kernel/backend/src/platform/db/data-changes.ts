type ChangedRows = (rows: "new_rows" | "old_rows") => string;

/** A row's user and, for a global row with a schema, that schema's slug. */
const changed = (user: string, slug?: string) =>
	`${user} as user_id, ${slug === undefined ? "null::text" : `case when ${user} is null then ${slug} end`} as schema_slug`;

const ownRows =
	(user: string, slug?: string): ChangedRows =>
	(rows) =>
		`select ${changed(user, slug)} from ${rows}`;

const entityRows: ChangedRows = (rows) =>
	`select ${changed("e.user_id", "e.entity_schema_slug")} from ${rows} r join entity e on e.id = r.entity_id`;

// A request's activity is its requester's; a checked request changes its entity's provider check.
const enrichmentRows: ChangedRows = (rows) =>
	`select ${changed("requester_user_id")} from ${rows} where requester_user_id is not null
	union all ${entityRows(rows)} where r.base_checked_at is not null`;

const events = [
	{ event: "insert", rows: ["new_rows"], referencing: "new table as new_rows" },
	{ event: "delete", rows: ["old_rows"], referencing: "old table as old_rows" },
	{
		event: "update",
		rows: ["new_rows", "old_rows"],
		referencing: "new table as new_rows old table as old_rows",
	},
] as const;

const recorded: ReadonlyArray<{
	readonly name: string;
	readonly rows: ChangedRows;
	readonly tables: readonly string[];
}> = [
	{ name: "entities", tables: ["entity"], rows: ownRows("user_id", "entity_schema_slug") },
	{
		name: "relationships",
		tables: ["relationship"],
		rows: ownRows("user_id", "relationship_schema_slug"),
	},
	{
		name: "user_rows",
		rows: ownRows("user_id"),
		tables: ["event", "derived_value", "plugin_installation"],
	},
	{ name: "plugins", tables: ["plugin"], rows: ownRows("owner_user_id") },
	{ rows: entityRows, name: "translations", tables: ["entity_translation"] },
	{ name: "enrichment", rows: enrichmentRows, tables: ["entity_enrichment_request"] },
];

// Triggers, because every writer of what a signal schedule reads has to record its change: change
// sets, folds, enrichment, translations, plugin activation, backup restores and migrations. A null
// user is a change to global data, and a null schema slug on it reaches every schedule. PostgreSQL
// allows transition tables only on single-event triggers.
export const dataChangeStatements = recorded.flatMap(({ name, tables, rows: changedRows }) =>
	events.flatMap(({ rows, event, referencing }) => {
		const fn = `ryot_record_${name}_${event}`;
		return [
			`create or replace function ${fn}() returns trigger language plpgsql set search_path from current as $$
begin
	insert into data_change (user_id, schema_slug, transaction_id)
	select distinct changed.user_id, changed.schema_slug, pg_current_xact_id()
	from (${rows.map(changedRows).join(" union all ")}) changed
	on conflict do nothing;
	return null;
end $$`,
		].concat(
			tables.map(
				(table) =>
					`create or replace trigger ryot_data_change_${event} after ${event} on ${table} referencing ${referencing} for each statement execute function ${fn}()`,
			),
		);
	}),
);
