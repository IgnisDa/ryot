import { getColumns, sql } from "drizzle-orm";

import { plugin, pluginRevision, sandboxScript } from "#lib/infrastructure/db/schema/tables/core";

// The mutable half of the catalog: plugin identity, status, and the active revision pointer.
// Immutable revision content is never selected here; callers read it with
// `PluginRepository.readRevisions`.
export const pluginPointerFields = getColumns(plugin);

export const scriptPluginId = sql<
	string | null
>`(select plugin_id from ${pluginRevision} where id = ${sandboxScript.pluginRevisionId})`;

export const storedScriptFields = {
	id: sandboxScript.id,
	slug: sandboxScript.slug,
	name: sandboxScript.name,
	pluginId: scriptPluginId,
	metadata: sandboxScript.metadata,
	providerId: sandboxScript.providerId,
	contentHash: sandboxScript.contentHash,
	pluginRevisionId: sandboxScript.pluginRevisionId,
};
