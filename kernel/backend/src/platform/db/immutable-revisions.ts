import { type SQL, sql } from "drizzle-orm";

export const pluginRevisionSections = (manifest: SQL) => ({
	hooks: sql`${manifest} -> 'hooks'`.as("hooks"),
	crons: sql`${manifest} -> 'crons'`.as("crons"),
	client: sql`${manifest} -> 'client'`.as("client"),
	scripts: sql`${manifest} -> 'scripts'`.as("scripts"),
	workflows: sql`${manifest} -> 'workflows'`.as("workflows"),
	providers: sql`${manifest} -> 'providers'`.as("providers"),
	name: sql`${manifest} -> 'metadata' ->> 'name'`.as("name"),
	icon: sql`${manifest} -> 'metadata' ->> 'icon'`.as("icon"),
	operations: sql`${manifest} -> 'operations'`.as("operations"),
	version: sql`${manifest} -> 'metadata' ->> 'version'`.as("version"),
	configSchema: sql`${manifest} -> 'configSchema'`.as("config_schema"),
	signalSchemas: sql`${manifest} -> 'signalSchemas'`.as("signal_schemas"),
	entitySchemas: sql`${manifest} -> 'entitySchemas'`.as("entity_schemas"),
	userBootstrap: sql`${manifest} -> 'userBootstrap'`.as("user_bootstrap"),
	oauthProviders: sql`${manifest} -> 'oauthProviders'`.as("oauth_providers"),
	packageId: sql`${manifest} -> 'metadata' ->> 'packageId'`.as("package_id"),
	httpRateLimits: sql`${manifest} -> 'httpRateLimits'`.as("http_rate_limits"),
	description: sql`${manifest} -> 'metadata' ->> 'description'`.as("description"),
	userSettingsSchema: sql`${manifest} -> 'userSettingsSchema'`.as("user_settings_schema"),
	relationshipSchemas: sql`${manifest} -> 'relationshipSchemas'`.as("relationship_schemas"),
	integrationProviders: sql`${manifest} -> 'integrationProviders'`.as("integration_providers"),
});

// TODO: Drizzle cannot generate triggers (https://github.com/drizzle-team/drizzle-orm/issues/843), so startup installs these after migrations.
export const immutableRevisionStatements = [
	`create or replace function ryot_reject_revision_update() returns trigger language plpgsql as $$
begin
	raise exception using errcode = 'P0001', message = 'plugin revisions are immutable';
end $$`,
	`create or replace trigger ryot_plugin_revision_immutable before update on plugin_revision for each row execute function ryot_reject_revision_update()`,
	`create or replace trigger ryot_plugin_revision_manifest_immutable before update on plugin_revision_manifest for each row execute function ryot_reject_revision_update()`,
	`create or replace function ryot_check_revision_manifest_sections() returns trigger language plpgsql as $$
begin
	if exists (
		select 1 from plugin_revision r
		where r.id = new.plugin_revision_id and (
			r.name is distinct from (new.manifest -> 'metadata' ->> 'name')
			or r.icon is distinct from (new.manifest -> 'metadata' ->> 'icon')
			or r.description is distinct from (new.manifest -> 'metadata' ->> 'description')
			or r.version is distinct from (new.manifest -> 'metadata' ->> 'version')
			or r.package_id is distinct from (new.manifest -> 'metadata' ->> 'packageId')
			or r.client is distinct from (new.manifest -> 'client')
			or r.hooks is distinct from (new.manifest -> 'hooks')
			or r.crons is distinct from (new.manifest -> 'crons')
			or r.scripts is distinct from (new.manifest -> 'scripts')
			or r.workflows is distinct from (new.manifest -> 'workflows')
			or r.providers is distinct from (new.manifest -> 'providers')
			or r.oauth_providers is distinct from (new.manifest -> 'oauthProviders')
			or r.operations is distinct from (new.manifest -> 'operations')
			or r.config_schema is distinct from (new.manifest -> 'configSchema')
			or r.signal_schemas is distinct from (new.manifest -> 'signalSchemas')
			or r.entity_schemas is distinct from (new.manifest -> 'entitySchemas')
			or r.user_bootstrap is distinct from (new.manifest -> 'userBootstrap')
			or r.user_settings_schema is distinct from (new.manifest -> 'userSettingsSchema')
			or r.http_rate_limits is distinct from (new.manifest -> 'httpRateLimits')
			or r.relationship_schemas is distinct from (new.manifest -> 'relationshipSchemas')
			or r.integration_providers is distinct from (new.manifest -> 'integrationProviders')
		)
	) then
		raise exception using errcode = 'P0001', message = 'plugin revision sections do not match its manifest';
	end if;
	return null;
end $$`,
	`create or replace trigger ryot_revision_manifest_sections after insert on plugin_revision_manifest for each row execute function ryot_check_revision_manifest_sections()`,
	`create or replace function ryot_require_revision_manifest() returns trigger language plpgsql as $$
begin
	if exists (
		select 1 from plugin_revision r
		where r.id = new.id
		and not exists (select 1 from plugin_revision_manifest m where m.plugin_revision_id = r.id)
	) then
		raise exception using errcode = 'P0001', message = 'plugin revision has no manifest';
	end if;
	return null;
end $$`,
	`drop trigger if exists ryot_revision_manifest_present on plugin_revision`,
	`create constraint trigger ryot_revision_manifest_present after insert on plugin_revision deferrable initially deferred for each row execute function ryot_require_revision_manifest()`,
];
