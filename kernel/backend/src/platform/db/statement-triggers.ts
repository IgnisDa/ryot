const events = [
	{ event: "insert", rows: ["new_rows"], referencing: "new table as new_rows" },
	{ event: "delete", rows: ["old_rows"], referencing: "old table as old_rows" },
	{
		event: "update",
		rows: ["new_rows", "old_rows"],
		referencing: "new table as new_rows old table as old_rows",
	},
] as const;

export type TransitionTable = TriggerEvent["rows"][number];

type TriggerEvent = (typeof events)[number];

// PostgreSQL allows transition tables only on single-event triggers without a column list, so each
// event gets its own function and, on every table, its own trigger.
export const statementTriggers = (trigger: {
	readonly trigger: string;
	readonly function: string;
	readonly tables: ReadonlyArray<string>;
	readonly body: (event: TriggerEvent) => string;
}) =>
	events.flatMap((event) => {
		const fn = `${trigger.function}_${event.event}`;
		return [
			`create or replace function ${fn}() returns trigger language plpgsql set search_path from current as $$
begin
	${trigger.body(event)};
	return null;
end $$`,
		].concat(
			trigger.tables.map(
				(table) =>
					`create or replace trigger ${trigger.trigger}_${event.event} after ${event.event} on ${table} referencing ${event.referencing} for each statement execute function ${fn}()`,
			),
		);
	});
