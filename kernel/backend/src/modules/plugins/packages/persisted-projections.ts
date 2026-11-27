import type { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { getColumns, sql } from "drizzle-orm";

import { plugin, pluginRevision, sandboxScript } from "#schema/tables/core";

export const pluginPointerFields = getColumns(plugin);

export const scriptPluginId = sql<
	null | string
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

export const catalogScriptFields = {
	id: sandboxScript.id,
	slug: sandboxScript.slug,
	name: sandboxScript.name,
	metadata: sandboxScript.metadata,
	providerId: sandboxScript.providerId,
	contentHash: sandboxScript.contentHash,
	pluginRevisionId: sandboxScript.pluginRevisionId,
};

export type CatalogScript = { readonly pluginId: string; readonly id: SandboxScriptId } & Omit<
	Pick<typeof sandboxScript.$inferSelect, keyof typeof catalogScriptFields>,
	"id"
>;
