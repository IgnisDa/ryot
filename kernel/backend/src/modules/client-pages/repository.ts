import type {
	ClientPageCompositionIdentity,
	ClientPageCompositionManifest,
} from "@ryot-app/contract/modules/client-pages/schemas";
import { SavedViewId, type UserId } from "@ryot-app/contract/schema/brands";
import { and, eq, getTableColumns } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

export class ClientPagesRepository extends Context.Service<ClientPagesRepository>()(
	"ClientPagesRepository",
	{
		make: Effect.sync(() => {
			const findPreparedTarget = Effect.fn("ClientPagesRepository.findPreparedTarget")(function* (
				userId: UserId,
				savedViewId: string,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ view: getTableColumns(schema.savedView) })
						.from(schema.savedView)
						.where(and(eq(schema.savedView.slug, savedViewId), eq(schema.savedView.userId, userId)))
						.limit(1),
				);
				return row ? { ...row, viewId: SavedViewId.make(row.view.id) } : null;
			});

			const listPreparedTargets = Effect.fn("ClientPagesRepository.listPreparedTargets")(function* (
				userId: UserId,
			) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select({ view: getTableColumns(schema.savedView) })
						.from(schema.savedView)
						.where(
							and(eq(schema.savedView.userId, userId), eq(schema.savedView.isDisabled, false)),
						),
				);
				return rows.map((row) => Object.assign(row, { viewId: SavedViewId.make(row.view.id) }));
			});

			const findComposition = Effect.fn("ClientPagesRepository.findComposition")(function* (
				compositionKey: string,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.clientPageComposition)
						.where(eq(schema.clientPageComposition.compositionKey, compositionKey))
						.limit(1),
				);
				return row ?? null;
			});

			const findCompositionByHash = Effect.fn("ClientPagesRepository.findCompositionByHash")(
				function* (compositionHash: string) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
						db
							.select()
							.from(schema.clientPageComposition)
							.where(eq(schema.clientPageComposition.compositionHash, compositionHash))
							.limit(1),
					);
					return row ?? null;
				},
			);

			const createComposition = Effect.fn("ClientPagesRepository.createComposition")(
				function* (input: {
					readonly compositionKey: string;
					readonly compositionHash: string;
					readonly identity: ClientPageCompositionIdentity;
					readonly manifest: ClientPageCompositionManifest;
				}) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
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
				},
			);
			return {
				findComposition,
				createComposition,
				findPreparedTarget,
				listPreparedTargets,
				findCompositionByHash,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
