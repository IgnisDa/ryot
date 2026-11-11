import { type SQL, sql } from "drizzle-orm";

export const pluginRevisionSections = (manifest: SQL) => ({
	manifest: sql`${manifest}`.as("manifest"),
	hooks: sql`${manifest} -> 'hooks'`.as("hooks"),
	crons: sql`${manifest} -> 'crons'`.as("crons"),
	client: sql`${manifest} -> 'client'`.as("client"),
	queries: sql`${manifest} -> 'queries'`.as("queries"),
	scripts: sql`${manifest} -> 'scripts'`.as("scripts"),
	workflows: sql`${manifest} -> 'workflows'`.as("workflows"),
	providers: sql`${manifest} -> 'providers'`.as("providers"),
	name: sql`${manifest} -> 'metadata' ->> 'name'`.as("name"),
	icon: sql`${manifest} -> 'metadata' ->> 'icon'`.as("icon"),
	operations: sql`${manifest} -> 'operations'`.as("operations"),
	memberships: sql`${manifest} -> 'memberships'`.as("memberships"),
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
	`create or replace function ryot_reject_revision_update() returns trigger language plpgsql set search_path from current as $$
begin
	raise exception using errcode = 'P0001', message = 'plugin revisions are immutable';
end $$`,
	`create or replace trigger ryot_plugin_revision_immutable before update on plugin_revision for each row execute function ryot_reject_revision_update()`,
];
