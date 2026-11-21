type ChangedUsers = (rows: "new_rows" | "old_rows") => string;

const userColumn =
	(column: string): ChangedUsers =>
	(rows) =>
		`select ${column} as user_id from ${rows}`;

const entityOwner: ChangedUsers = (rows) =>
	`select e.user_id from ${rows} r join entity e on e.id = r.entity_id`;

// A request's activity is its requester's; a checked request changes its entity's provider check.
const enrichmentUsers: ChangedUsers = (rows) =>
	`select requester_user_id as user_id from ${rows} where requester_user_id is not null
	union all select e.user_id from ${rows} r join entity e on e.id = r.entity_id where r.base_checked_at is not null`;

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
	readonly users: ChangedUsers;
	readonly tables: readonly string[];
}> = [
	{
		name: "user_rows",
		users: userColumn("user_id"),
		tables: ["entity", "relationship", "event", "derived_value", "plugin_installation"],
	},
	{ name: "plugins", tables: ["plugin"], users: userColumn("owner_user_id") },
	{ users: entityOwner, name: "translations", tables: ["entity_translation"] },
	{ name: "enrichment", users: enrichmentUsers, tables: ["entity_enrichment_request"] },
];

// Triggers, because every writer of what a signal schedule reads has to record its change: change
// sets, folds, enrichment, translations, plugin activation, backup restores and migrations. A null
// user is a change to global data. PostgreSQL allows transition tables only on single-event triggers.
export const dataChangeStatements = recorded.flatMap(({ name, users, tables }) =>
	events.flatMap(({ rows, event, referencing }) => {
		const fn = `ryot_record_${name}_${event}`;
		return [
			`create or replace function ${fn}() returns trigger language plpgsql set search_path from current as $$
begin
	insert into data_change (user_id, transaction_id)
	select distinct changed.user_id, pg_current_xact_id()
	from (${rows.map(users).join(" union all ")}) changed
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
