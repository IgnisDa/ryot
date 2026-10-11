import type {
	ClientPageCompositionIdentity,
	ClientPageCompositionManifest,
} from "@ryot-app/contract/modules/pages/schemas";
import type { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import { SavedViewId, type UserId } from "@ryot-app/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { savedViewReferenceWhere } from "#platform/db/definition-owner";
import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

export class PagesRepository extends Context.Service<PagesRepository>()("PagesRepository", {
	make: Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const findHomeSavedView = Effect.fn("PagesRepository.findHomeSavedView")(function* (
			userId: UserId,
			pluginId: string,
		) {
			const [row] = yield* session.run((db) =>
				db
					.select({ reference: schema.pluginInstallation.homeSavedView })
					.from(schema.pluginInstallation)
					.where(
						and(
							eq(schema.pluginInstallation.userId, userId),
							eq(schema.pluginInstallation.pluginId, pluginId),
						),
					)
					.limit(1),
			);
			return row?.reference ?? null;
		});
		const findPreparedTarget = Effect.fn("PagesRepository.findPreparedTarget")(function* (
			userId: UserId,
			reference: SavedViewReference,
		) {
			const [row] = yield* session.run((db) =>
				db
					.select()
					.from(schema.userSavedViewEffective)
					.where(
						and(
							savedViewReferenceWhere(reference),
							eq(schema.userSavedViewEffective.userId, userId),
						),
					)
					.limit(1),
			);
			return row ? { view: row, viewId: SavedViewId.make(row.id) } : null;
		});

		const findComposition = Effect.fn("PagesRepository.findComposition")(function* (
			compositionKey: string,
		) {
			const [row] = yield* session.run((db) =>
				db
					.select()
					.from(schema.clientPageComposition)
					.where(eq(schema.clientPageComposition.compositionKey, compositionKey))
					.limit(1),
			);
			return row ?? null;
		});

		const createComposition = Effect.fn("PagesRepository.createComposition")(function* (input: {
			readonly compositionKey: string;
			readonly compositionHash: string;
			readonly identity: ClientPageCompositionIdentity;
			readonly manifest: ClientPageCompositionManifest;
		}) {
			const [row] = yield* session.run((db) =>
				db
					.insert(schema.clientPageComposition)
					.values(input)
					.onConflictDoNothing()
					.returning({ compositionKey: schema.clientPageComposition.compositionKey }),
			);
			const existing = row ? null : yield* findComposition(input.compositionKey);
			if (
				!row &&
				(!existing ||
					existing.compositionHash !== input.compositionHash ||
					!Bun.deepEquals(existing.identity, input.identity) ||
					!Bun.deepEquals(existing.manifest, input.manifest))
			) {
				return yield* Effect.die(new Error("Conflicting immutable client page composition"));
			}
			return row?.compositionKey ?? existing?.compositionKey ?? input.compositionKey;
		});
		return { findComposition, createComposition, findHomeSavedView, findPreparedTarget };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
