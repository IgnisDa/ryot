import type { AutomationRetryEligibility } from "@ryot-app/contract/modules/automations/history-schemas";
import { type SQL, sql } from "drizzle-orm";

import { automationTrigger } from "#lib/infrastructure/db/schema/tables/automations";
import {
	pluginConfigEncryptionKey,
	pluginConfigRevision,
	pluginRevision,
	sandboxScript,
} from "#lib/infrastructure/db/schema/tables/core";

export const automationRunRetryEligibility = (
	runAlias: string,
	now: SQL,
	options: { readonly lockArtifacts: boolean } = { lockArtifacts: false },
) => {
	const run = (column: string) => sql`${sql.identifier(runAlias)}.${sql.identifier(column)}`;
	const lock = options.lockArtifacts ? sql` for share` : sql``;
	const artifactsAvailable = sql`${run("sandbox_script_id")} is not null
		and exists (select 1 from ${automationTrigger} t where t.id = ${run("trigger_id")} and t.payload is not null${lock})
		and exists (select 1 from ${sandboxScript} s where s.id = ${run("sandbox_script_id")} and s.slug = ${run("script_slug")} and s.content_hash = ${run("script_content_hash")} and s.plugin_revision_id is not distinct from ${run("plugin_revision_id")}${lock})
		and case when ${run("plugin_id")} is null then ${run("plugin_revision_id")} is null and ${run("plugin_config_revision_id")} is null else exists (
			select 1 from ${pluginRevision} r
			join ${pluginConfigRevision} c on c.id = ${run("plugin_config_revision_id")}
			join ${pluginConfigEncryptionKey} k on k.id = c.encryption_key_id
			where r.id = ${run("plugin_revision_id")} and r.plugin_id = ${run("plugin_id")} and c.encrypted_payload is not null and c.plugin_revision_id = ${run("plugin_revision_id")} and (c.scope <> 'installation' or c.owner_user_id is not distinct from ${run("execution_user_id")}) and octet_length(k.key) = 32${lock}
		) end`;
	return sql<AutomationRetryEligibility["reason"]>`case
		when ${run("stage")} = 'before' then 'before-policy'
		when ${run("status")} <> 'failed' then 'not-failed'
		when not (${now} < ${run("artifacts_expire_at")}) then 'expired'
		when not (${artifactsAvailable}) then 'missing-artifact'
	end`;
};
