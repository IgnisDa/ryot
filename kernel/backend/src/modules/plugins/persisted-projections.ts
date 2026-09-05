import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { getColumns, sql } from "drizzle-orm";

import { plugin, pluginRevision, sandboxScript } from "#lib/infrastructure/db/schema/tables/core";

export const activePluginFields = {
	...getColumns(plugin),
	version: sql<string>`(select version from ${pluginRevision} where id = ${plugin.activeRevisionId})`,
	sourceHash: sql<string>`(select source_hash from ${pluginRevision} where id = ${plugin.activeRevisionId})`,
	manifest: sql<PluginManifest>`(select manifest from ${pluginRevision} where id = ${plugin.activeRevisionId})`,
	compiledHashes: sql<
		Record<string, string>
	>`(select coalesce(jsonb_object_agg(slug, content_hash), '{}'::jsonb) from ${sandboxScript} where plugin_revision_id = ${plugin.activeRevisionId})`,
};

export const scriptPluginId = sql<
	string | null
>`(select plugin_id from ${pluginRevision} where id = ${sandboxScript.pluginRevisionId})`;
export const storedScriptFields = { ...getColumns(sandboxScript), pluginId: scriptPluginId };
