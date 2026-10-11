import type { DeclarationReference } from "@ryot-app/contract/modules/plugins/references";
import { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import type { DatabaseSession } from "#lib/infrastructure/db/session";
import { findRevisionScriptForSession } from "#modules/plugins/runtime-resolver";

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
					manifest: tables.pluginRevision.manifest,
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
		const declaration = row?.manifest.providers.find(({ slug }) => slug === reference.slug);
		return row && declaration?.rootEntitySchemaSlug === row.rootEntitySchemaSlug
			? { id: SandboxProviderId.make(row.id), rootEntitySchemaSlug: row.rootEntitySchemaSlug }
			: null;
	});
	return { findPinnedProvider, findRevisionScript };
};
