// Each trigger writes only the column group its table owns and takes FOR SHARE on every other row it
// reads before writing, so a concurrent writer of that row either committed first or waits for this
// transaction and then refreshes the state row from a fresh snapshot.
export const userPluginStateStatements = [
	`create or replace function ryot_refresh_user_plugin_state(installation_ids text[]) returns void language plpgsql volatile security invoker set search_path from current as $$
begin
	perform 1 from plugin p
	where p.id in (select i.plugin_id from plugin_installation i where i.id = any(installation_ids))
	order by p.id
	for share of p;
	perform 1 from plugin_config_revision c
	where c.id in (
		select i.active_config_revision_id from plugin_installation i where i.id = any(installation_ids)
		union
		select p.environment_config_revision_id from plugin_installation i join plugin p on p.id = i.plugin_id where i.id = any(installation_ids)
	)
	order by c.id
	for share of c;
	insert into user_plugin_state (
		installation_id, user_id, plugin_id, health, is_hidden, sort_order, is_uninstalled,
		installation_config_revision_id, installation_config_plugin_revision_id, installation_config_is_usable,
		package_id, owner_user_id, plugin_status, active_revision_id, environment_config_revision_id, environment_config_is_usable
	)
	select i.id, i.user_id, i.plugin_id, i.health, i.is_hidden, i.sort_order, i.uninstalled_at is not null,
		i.active_config_revision_id, ic.plugin_revision_id,
		coalesce(ic.encrypted_payload is not null and ic.owner_user_id = i.user_id and ic.plugin_installation_id = i.id, false),
		p.package_id, p.owner_user_id, p.status, p.active_revision_id, p.environment_config_revision_id,
		coalesce(ec.plugin_revision_id = p.active_revision_id and ec.encrypted_payload is not null and ec.owner_user_id is null, false)
	from plugin_installation i
	join plugin p on p.id = i.plugin_id
	left join plugin_config_revision ic on ic.id = i.active_config_revision_id
	left join plugin_config_revision ec on ec.id = p.environment_config_revision_id
	where i.id = any(installation_ids)
	on conflict (installation_id) do update set
		user_id = excluded.user_id,
		plugin_id = excluded.plugin_id,
		health = excluded.health,
		is_hidden = excluded.is_hidden,
		sort_order = excluded.sort_order,
		is_uninstalled = excluded.is_uninstalled,
		installation_config_revision_id = excluded.installation_config_revision_id,
		installation_config_plugin_revision_id = excluded.installation_config_plugin_revision_id,
		installation_config_is_usable = excluded.installation_config_is_usable,
		package_id = excluded.package_id,
		owner_user_id = excluded.owner_user_id,
		plugin_status = excluded.plugin_status,
		active_revision_id = excluded.active_revision_id,
		environment_config_revision_id = excluded.environment_config_revision_id,
		environment_config_is_usable = excluded.environment_config_is_usable;
end $$`,
	`create or replace function ryot_user_plugin_state_installation_inserted() returns trigger language plpgsql volatile security invoker set search_path from current as $$
begin
	perform ryot_refresh_user_plugin_state(array(select n.id from new_rows n));
	return null;
end $$`,
	`create or replace trigger ryot_user_plugin_state_installation_insert after insert on plugin_installation referencing new table as new_rows for each statement execute function ryot_user_plugin_state_installation_inserted()`,
	`create or replace function ryot_user_plugin_state_installation_updated() returns trigger language plpgsql volatile security invoker set search_path from current as $$
begin
	if new.user_id is distinct from old.user_id or new.plugin_id is distinct from old.plugin_id then
		perform ryot_refresh_user_plugin_state(array[new.id]);
		return null;
	end if;
	perform 1 from plugin_config_revision c where c.id = new.active_config_revision_id for share of c;
	update user_plugin_state s set
		health = new.health,
		is_hidden = new.is_hidden,
		sort_order = new.sort_order,
		is_uninstalled = new.uninstalled_at is not null,
		installation_config_revision_id = new.active_config_revision_id,
		installation_config_plugin_revision_id = (
			select c.plugin_revision_id from plugin_config_revision c where c.id = new.active_config_revision_id
		),
		installation_config_is_usable = coalesce((
			select c.encrypted_payload is not null and c.owner_user_id = new.user_id and c.plugin_installation_id = new.id
			from plugin_config_revision c where c.id = new.active_config_revision_id
		), false)
	where s.installation_id = new.id;
	return null;
end $$`,
	`create or replace trigger ryot_user_plugin_state_installation_update after update on plugin_installation for each row when (
		old.user_id is distinct from new.user_id
		or old.plugin_id is distinct from new.plugin_id
		or old.health is distinct from new.health
		or old.is_hidden is distinct from new.is_hidden
		or old.sort_order is distinct from new.sort_order
		or old.uninstalled_at is distinct from new.uninstalled_at
		or old.active_config_revision_id is distinct from new.active_config_revision_id
	) execute function ryot_user_plugin_state_installation_updated()`,
	`create or replace function ryot_user_plugin_state_plugin_updated() returns trigger language plpgsql volatile security invoker set search_path from current as $$
begin
	perform 1 from plugin_config_revision c where c.id = new.environment_config_revision_id for share of c;
	update user_plugin_state s set
		package_id = new.package_id,
		owner_user_id = new.owner_user_id,
		plugin_status = new.status,
		active_revision_id = new.active_revision_id,
		environment_config_revision_id = new.environment_config_revision_id,
		environment_config_is_usable = coalesce((
			select c.plugin_revision_id = new.active_revision_id and c.encrypted_payload is not null and c.owner_user_id is null
			from plugin_config_revision c where c.id = new.environment_config_revision_id
		), false)
	where s.plugin_id = new.id;
	return null;
end $$`,
	`create or replace trigger ryot_user_plugin_state_plugin_update after update on plugin for each row when (
		old.status is distinct from new.status
		or old.active_revision_id is distinct from new.active_revision_id
		or old.environment_config_revision_id is distinct from new.environment_config_revision_id
		or old.owner_user_id is distinct from new.owner_user_id
		or old.package_id is distinct from new.package_id
	) execute function ryot_user_plugin_state_plugin_updated()`,
	`create or replace function ryot_user_plugin_state_config_updated() returns trigger language plpgsql volatile security invoker set search_path from current as $$
begin
	update user_plugin_state s set
		installation_config_plugin_revision_id = new.plugin_revision_id,
		installation_config_is_usable = coalesce(new.encrypted_payload is not null and new.owner_user_id = s.user_id and new.plugin_installation_id = s.installation_id, false)
	where s.installation_config_revision_id = new.id;
	update user_plugin_state s set
		environment_config_is_usable = coalesce(new.plugin_revision_id = s.active_revision_id and new.encrypted_payload is not null and new.owner_user_id is null, false)
	where s.environment_config_revision_id = new.id;
	return null;
end $$`,
	`create or replace trigger ryot_user_plugin_state_config_update after update on plugin_config_revision for each row when (
		old.encrypted_payload is distinct from new.encrypted_payload
		or old.owner_user_id is distinct from new.owner_user_id
		or old.plugin_installation_id is distinct from new.plugin_installation_id
		or old.plugin_revision_id is distinct from new.plugin_revision_id
	) execute function ryot_user_plugin_state_config_updated()`,
];
