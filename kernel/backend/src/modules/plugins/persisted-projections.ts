import type { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { getColumns, sql } from "drizzle-orm";

import { plugin, pluginRevision, sandboxScript } from "#lib/infrastructure/db/schema/tables/core";

// The mutable half of the catalog: plugin identity, status, and the active revision pointer.
// Immutable revision content is never selected here; callers join `plugin_revision`.
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

export const catalogScriptFields = {
	id: sandboxScript.id,
	slug: sandboxScript.slug,
	name: sandboxScript.name,
	metadata: sandboxScript.metadata,
	providerId: sandboxScript.providerId,
	contentHash: sandboxScript.contentHash,
	pluginRevisionId: sandboxScript.pluginRevisionId,
};

export type CatalogScript = Omit<
	Pick<typeof sandboxScript.$inferSelect, keyof typeof catalogScriptFields>,
	"id"
> & { readonly id: SandboxScriptId; readonly pluginId: string };
