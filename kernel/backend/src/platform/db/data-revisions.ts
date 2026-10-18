const revisionTriggers = (table: string, owner: string) =>
	(["insert", "update", "delete"] as const).flatMap((operation) => {
		const sources = [
			...(operation === "insert" ? [] : ["old_rows"]),
			...(operation === "delete" ? [] : ["new_rows"]),
		];
		const transitions = [
			...(operation === "insert" ? [] : ["old table as old_rows"]),
			...(operation === "delete" ? [] : ["new table as new_rows"]),
		].join(" ");
		const name = `ryot_${table}_data_revision_${operation}`;
		return [
			`create or replace function ${name}() returns trigger language plpgsql volatile security invoker set search_path from current as $$
begin
	insert into data_revision (id, plugin_id, user_id, revision)
	select md5(jsonb_build_array(t.plugin_id, t.user_id)::text), t.plugin_id, t.user_id, 1
	from (${sources.map((source) => `select distinct ${owner} as plugin_id, user_id from ${source}`).join(" union ")}) t
	where (t.plugin_id is null or exists (select 1 from plugin p where p.id = t.plugin_id))
	and (t.user_id is null or exists (select 1 from "user" u where u.id = t.user_id))
	order by 1
	on conflict (id) do update set revision = data_revision.revision + 1;
	return null;
end $$`,
			`create or replace trigger ${name} after ${operation} on ${table} referencing ${transitions} for each statement execute function ${name}()`,
		];
	});

export const dataRevisionStatements = [
	...revisionTriggers("entity", "entity_schema_plugin_id"),
	...revisionTriggers("relationship", "relationship_schema_plugin_id"),
];
