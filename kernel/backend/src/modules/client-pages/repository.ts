import type { ClientPageArtifactIdentity } from "@ryot-app/contract/modules/client-pages/schemas";
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

			const findBuild = Effect.fn("ClientPagesRepository.findBuild")(function* (
				artifactKey: string,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({
							format: schema.pluginClientArtifact.format,
							artifactKey: schema.clientPageBuild.artifactKey,
							artifactHash: schema.clientPageBuild.artifactHash,
							apiVersion: schema.pluginClientArtifact.apiVersion,
							bridgeVersion: schema.pluginClientArtifact.bridgeVersion,
							artifactIdentity: schema.clientPageBuild.artifactIdentity,
							compilerVersion: schema.pluginClientArtifact.compilerVersion,
						})
						.from(schema.clientPageBuild)
						.innerJoin(
							schema.pluginClientArtifact,
							eq(schema.pluginClientArtifact.hash, schema.clientPageBuild.artifactHash),
						)
						.where(eq(schema.clientPageBuild.artifactKey, artifactKey))
						.limit(1),
				);
				return row ?? null;
			});

			const createBuild = Effect.fn("ClientPagesRepository.createBuild")(function* (input: {
				readonly artifactKey: string;
				readonly artifactHash: string;
				readonly artifactIdentity: ClientPageArtifactIdentity;
			}) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.insert(schema.clientPageBuild)
						.values(input)
						.onConflictDoNothing()
						.returning({ artifactKey: schema.clientPageBuild.artifactKey }),
				);
				const existing = row ? null : yield* findBuild(input.artifactKey);
				if (
					existing &&
					(existing.artifactHash !== input.artifactHash ||
						!Bun.deepEquals(existing.artifactIdentity, input.artifactIdentity))
				) {
					return yield* Effect.die(new Error("Conflicting immutable client page build"));
				}
				return row?.artifactKey ?? existing?.artifactKey ?? input.artifactKey;
			});

			const findArtifactFile = Effect.fn("ClientPagesRepository.findArtifactFile")(function* (
				artifactHash: string,
				fileName: string,
			) {
				const db = yield* Database;
				const [file] = yield* mapDatabaseErrors(
					db
						.select({
							contents: schema.pluginClientArtifactFile.contents,
							contentType: schema.pluginClientArtifactFile.contentType,
						})
						.from(schema.pluginClientArtifactFile)
						.where(
							and(
								eq(schema.pluginClientArtifactFile.artifactHash, artifactHash),
								eq(schema.pluginClientArtifactFile.name, fileName),
							),
						)
						.limit(1),
				);
				return file ? { ...file, contents: new Uint8Array(file.contents) } : null;
			});

			return { findBuild, createBuild, findArtifactFile, findPreparedTarget, listPreparedTargets };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
