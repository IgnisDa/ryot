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
					providers: tables.pluginRevision.providers,
					rootEntitySchemaSlug: tables.sandboxProvider.rootEntitySchemaSlug,
				})
				.from(tables.sandboxProvider)
				.innerJoin(
					tables.pluginRevision,
					eq(tables.pluginRevision.pluginId, tables.sandboxProvider.pluginId),
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
		const declaration = row?.providers.find(({ slug }) => slug === reference.slug);
		return row && declaration?.rootEntitySchemaSlug === row.rootEntitySchemaSlug
			? { id: SandboxProviderId.make(row.id), rootEntitySchemaSlug: row.rootEntitySchemaSlug }
			: null;
	});
	const findRevisionProviders = Effect.fnUntraced(function* (revisionId: string) {
		const [row] = yield* session.run((db) =>
			db
				.select({ providers: tables.pluginRevision.providers })
				.from(tables.pluginRevision)
				.where(eq(tables.pluginRevision.id, revisionId))
				.limit(1),
		);
		return row?.providers;
	});
	return { findPinnedProvider, findRevisionScript, findRevisionProviders };
};
