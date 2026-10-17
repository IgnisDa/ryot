import type { PluginProviderOperation } from "@ryot-app/contract/modules/plugins/manifest";
import type { DeclarationReference } from "@ryot-app/contract/modules/plugins/references";
import { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import { findRevisionScriptForSession } from "#modules/plugins/catalog/runtime-resolver";
import type { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

export const makeProviderExecutionReads = (session: DatabaseSession["Service"]) => {
	const findRevisionScript = findRevisionScriptForSession(session);
	const findPinnedProvider = Effect.fnUntraced(function* (
		reference: DeclarationReference,
		revisionId: string,
	) {
		if (reference.owner.kind === "kernel") {
			return null;
		}
		const pluginId = reference.owner.pluginId;
		const [row] = yield* session.run((db) =>
			db
				.select({
					id: tables.sandboxProvider.id,
					rootEntitySchemaSlug: tables.sandboxProvider.rootEntitySchemaSlug,
					declaredRootEntitySchemaSlug: tables.definitionProvider.rootEntitySchemaSlug,
				})
				.from(tables.sandboxProvider)
				.innerJoin(
					tables.pluginRevision,
					eq(tables.pluginRevision.pluginId, tables.sandboxProvider.pluginId),
				)
				.innerJoin(
					tables.definitionProvider,
					and(
						eq(tables.definitionProvider.pluginRevisionId, tables.pluginRevision.id),
						eq(tables.definitionProvider.slug, tables.sandboxProvider.slug),
					),
				)
				.where(
					and(
						eq(tables.sandboxProvider.pluginId, pluginId),
						eq(tables.sandboxProvider.slug, reference.slug),
						eq(tables.pluginRevision.id, revisionId),
					),
				)
				.limit(1),
		);
		return row && row.declaredRootEntitySchemaSlug === row.rootEntitySchemaSlug
			? { id: SandboxProviderId.make(row.id), rootEntitySchemaSlug: row.rootEntitySchemaSlug }
			: null;
	});
	const findRevisionProviderOperation = Effect.fnUntraced(function* (input: {
		pluginId: string;
		revisionId: string;
		providerSlug: string;
		operation: PluginProviderOperation;
	}) {
		const [row] = yield* session.run((db) =>
			db
				.select({ scriptSlug: tables.definitionProviderOperation.scriptSlug })
				.from(tables.definitionProviderOperation)
				.innerJoin(
					tables.pluginRevision,
					eq(tables.pluginRevision.id, tables.definitionProviderOperation.pluginRevisionId),
				)
				.where(
					and(
						eq(tables.pluginRevision.pluginId, input.pluginId),
						eq(tables.definitionProviderOperation.pluginRevisionId, input.revisionId),
						eq(tables.definitionProviderOperation.providerSlug, input.providerSlug),
						eq(tables.definitionProviderOperation.operation, input.operation),
					),
				)
				.limit(1),
		);
		return row?.scriptSlug;
	});
	return { findPinnedProvider, findRevisionScript, findRevisionProviderOperation };
};
