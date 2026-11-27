// A trigger, because every writer has to agree with the declaration: services, backup restores, and
// one-time migrations that insert with raw SQL.
export const entityOccursAtStatements = [
	`create or replace function ryot_entity_occurs_at(occurs_at_properties text[], properties jsonb) returns timestamptz language sql stable set search_path from current as $$
	select source.value::timestamptz
	from unnest(occurs_at_properties) with ordinality as declared(property, position)
	cross join lateral (select properties ->> declared.property as value) source
	where pg_input_is_valid(source.value, 'timestamp with time zone')
		and lower(btrim(source.value)) not in ('infinity', '+infinity', '-infinity')
	order by declared.position
	limit 1
$$`,
	`create or replace function ryot_entity_set_occurs_at() returns trigger language plpgsql set search_path from current as $$
begin
	new.occurs_at := ryot_entity_occurs_at(
		(
			select d.occurs_at_properties
			from plugin p
			join definition_entity_schema d on d.plugin_revision_id = p.active_revision_id and d.slug = new.entity_schema_slug
			where p.id = new.entity_schema_plugin_id
		),
		new.properties
	);
	return new;
end $$`,
	`create or replace trigger ryot_entity_occurs_at before insert or update of properties on entity for each row when (new.entity_schema_plugin_id is not null) execute function ryot_entity_set_occurs_at()`,
	`create or replace function ryot_entity_occurs_at_revision_changed() returns trigger language plpgsql set search_path from current as $$
begin
	update entity e
	set occurs_at = ryot_entity_occurs_at(n.occurs_at_properties, e.properties)
	from definition_entity_schema n
	left join definition_entity_schema o on o.plugin_revision_id = old.active_revision_id and o.slug = n.slug
	where n.plugin_revision_id = new.active_revision_id
		and n.occurs_at_properties is distinct from o.occurs_at_properties
		and e.entity_schema_plugin_id = new.id
		and e.entity_schema_slug = n.slug;
	return null;
end $$`,
	`create or replace trigger ryot_entity_occurs_at_revision after update of active_revision_id on plugin for each row when (old.active_revision_id is distinct from new.active_revision_id) execute function ryot_entity_occurs_at_revision_changed()`,
];
