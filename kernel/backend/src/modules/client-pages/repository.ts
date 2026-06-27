import type { ClientRendererDefinition } from "@ryot-app/contract/modules/client-pages/schemas";
import { ClientRendererId, SavedViewId, type UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, getTableColumns } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

const toRecord = (row: typeof schema.clientRenderer.$inferSelect) => ({
	slug: row.slug,
	name: row.name,
	draftRevision: row.draftRevision,
	publishedHash: row.publishedHash,
	draftDefinition: row.draftDefinition,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	id: ClientRendererId.make(row.id),
	publishedRevision: row.publishedRevision,
	publishedDefinition: row.publishedDefinition,
});

export class ClientPagesRepository extends Context.Service<ClientPagesRepository>()(
	"ClientPagesRepository",
	{
		make: Effect.sync(() => {
			const createRenderer = Effect.fn("ClientPagesRepository.createRenderer")(function* (input: {
				readonly slug: string;
				readonly name: string;
				readonly userId: UserId;
				readonly draftDefinition: ClientRendererDefinition;
			}) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.insert(schema.clientRenderer)
						.values(input)
						.onConflictDoNothing({
							target: [schema.clientRenderer.userId, schema.clientRenderer.slug],
						})
						.returning(),
				);
				return row ? toRecord(row) : null;
			});

			const listRenderers = Effect.fn("ClientPagesRepository.listRenderers")(function* (
				userId: UserId,
			) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.clientRenderer)
						.where(eq(schema.clientRenderer.userId, userId))
						.orderBy(asc(schema.clientRenderer.createdAt)),
				);
				return rows.map(toRecord);
			});

			const findRenderer = Effect.fn("ClientPagesRepository.findRenderer")(function* (
				userId: UserId,
				rendererId: string,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.clientRenderer)
						.where(
							and(
								eq(schema.clientRenderer.id, rendererId),
								eq(schema.clientRenderer.userId, userId),
							),
						)
						.limit(1),
				);
				return row ? toRecord(row) : null;
			});

			const lockRenderer = Effect.fn("ClientPagesRepository.lockRenderer")(function* (
				userId: UserId,
				rendererId: string,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.clientRenderer)
						.where(
							and(
								eq(schema.clientRenderer.id, rendererId),
								eq(schema.clientRenderer.userId, userId),
							),
						)
						.for("update")
						.limit(1),
				);
				return row ?? null;
			});

			const replaceDraft = Effect.fn("ClientPagesRepository.replaceDraft")(function* (input: {
				readonly userId: UserId;
				readonly rendererId: string;
				readonly expectedRevision: number;
				readonly definition: ClientRendererDefinition;
			}) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.update(schema.clientRenderer)
						.set({
							draftDefinition: input.definition,
							draftRevision: input.expectedRevision + 1,
						})
						.where(
							and(
								eq(schema.clientRenderer.id, input.rendererId),
								eq(schema.clientRenderer.userId, input.userId),
								eq(schema.clientRenderer.draftRevision, input.expectedRevision),
							),
						)
						.returning(),
				);
				return row ? toRecord(row) : null;
			});

			const listDependentSettings = Effect.fn("ClientPagesRepository.listDependentSettings")(
				function* (userId: UserId, rendererId: string) {
					const db = yield* Database;
					return yield* mapDatabaseErrors(
						db
							.select({ settings: schema.savedView.settings })
							.from(schema.savedView)
							.where(
								and(
									eq(schema.savedView.userId, userId),
									eq(schema.savedView.clientRendererId, rendererId),
								),
							),
					);
				},
			);

			const publish = Effect.fn("ClientPagesRepository.publish")(function* (input: {
				readonly userId: UserId;
				readonly revision: number;
				readonly rendererId: string;
				readonly artifactHash: string;
				readonly publishedHash: string;
				readonly definition: ClientRendererDefinition;
			}) {
				const db = yield* Database;
				const [build] = yield* mapDatabaseErrors(
					db
						.insert(schema.clientPageBuild)
						.values({
							userId: input.userId,
							rendererId: input.rendererId,
							artifactHash: input.artifactHash,
							publishedHash: input.publishedHash,
						})
						.onConflictDoUpdate({
							set: { artifactHash: input.artifactHash },
							target: [schema.clientPageBuild.rendererId, schema.clientPageBuild.publishedHash],
						})
						.returning({ id: schema.clientPageBuild.id }),
				);
				if (!build) {
					return null;
				}
				const [renderer] = yield* mapDatabaseErrors(
					db
						.update(schema.clientRenderer)
						.set({
							publishedRevision: input.revision,
							publishedHash: input.publishedHash,
							publishedDefinition: input.definition,
							publishedArtifactHash: input.artifactHash,
						})
						.where(
							and(
								eq(schema.clientRenderer.id, input.rendererId),
								eq(schema.clientRenderer.userId, input.userId),
								eq(schema.clientRenderer.draftRevision, input.revision),
							),
						)
						.returning({ id: schema.clientRenderer.id }),
				);
				return renderer ? build.id : null;
			});

			const deleteRenderer = Effect.fn("ClientPagesRepository.deleteRenderer")(function* (
				userId: UserId,
				rendererId: string,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.delete(schema.clientRenderer)
						.where(
							and(
								eq(schema.clientRenderer.id, rendererId),
								eq(schema.clientRenderer.userId, userId),
							),
						)
						.returning(),
				);
				return row ? toRecord(row) : null;
			});

			const findPreparedTarget = Effect.fn("ClientPagesRepository.findPreparedTarget")(function* (
				userId: UserId,
				savedViewId: string,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({
							buildId: schema.clientPageBuild.id,
							view: getTableColumns(schema.savedView),
							renderer: getTableColumns(schema.clientRenderer),
						})
						.from(schema.savedView)
						.innerJoin(
							schema.clientRenderer,
							eq(schema.savedView.clientRendererId, schema.clientRenderer.id),
						)
						.innerJoin(
							schema.clientPageBuild,
							and(
								eq(schema.clientPageBuild.rendererId, schema.clientRenderer.id),
								eq(schema.clientPageBuild.publishedHash, schema.clientRenderer.publishedHash),
							),
						)
						.where(and(eq(schema.savedView.id, savedViewId), eq(schema.savedView.userId, userId)))
						.limit(1),
				);
				return row
					? {
							...row,
							viewId: SavedViewId.make(row.view.id),
							rendererId: ClientRendererId.make(row.renderer.id),
						}
					: null;
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

			return {
				publish,
				lockRenderer,
				findRenderer,
				listRenderers,
				replaceDraft,
				createRenderer,
				deleteRenderer,
				findArtifactFile,
				findPreparedTarget,
				listDependentSettings,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
