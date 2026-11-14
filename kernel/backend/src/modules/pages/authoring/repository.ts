import type { PageDraftBuildIdentity } from "@ryot-app/contract/modules/pages/identity";
import {
	PageAuthoringError,
	type PageDefinition,
	type PageOrigin,
} from "@ryot-app/contract/modules/pages/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { page } from "#schema/tables/pages";

const owned = (userId: UserId, pageId: string) => and(eq(page.userId, userId), eq(page.id, pageId));

export class PageAuthoringRepository extends Context.Service<PageAuthoringRepository>()(
	"@ryot-app/kernel-backend/modules/pages/authoring/repository/PageAuthoringRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const find = Effect.fn("PageAuthoringRepository.find")(function* (
				userId: UserId,
				pageId: string,
			) {
				const [row] = yield* session.run((db) =>
					db.select().from(page).where(owned(userId, pageId)).limit(1),
				);
				return row ?? null;
			});
			const findCompiledDraft = Effect.fn("PageAuthoringRepository.findCompiledDraft")(function* (
				userId: UserId,
				identity: PageDraftBuildIdentity,
			) {
				const row = yield* find(userId, identity.pageId);
				return row &&
					row.draftRevision === identity.draftRevision &&
					row.draftCompiledRevision === identity.draftRevision &&
					row.draftDefinitionHash === identity.definitionHash &&
					row.draftArtifactHash === identity.artifactHash
					? row
					: null;
			});

			const lock = Effect.fn("PageAuthoringRepository.lock")(function* (
				userId: UserId,
				pageId: string,
			) {
				const [row] = yield* session.run((db) =>
					db.select().from(page).where(owned(userId, pageId)).for("update").limit(1),
				);
				return row ?? null;
			});
			const create = Effect.fn("PageAuthoringRepository.create")(function* (
				userId: UserId,
				input: {
					readonly slug: string;
					readonly name: string;
					readonly origin: PageOrigin;
					readonly definitionHash: string;
					readonly definition: PageDefinition;
				},
			) {
				const [row] = yield* session.run((db) =>
					db
						.insert(page)
						.values({
							userId,
							slug: input.slug,
							name: input.name,
							writeAccess: false,
							origin: input.origin,
							draftDefinition: input.definition,
							draftDefinitionHash: input.definitionHash,
						})
						.returning({ pageId: page.id, draftRevision: page.draftRevision }),
				);
				if (!row) {
					return yield* Effect.die("Page insert returned no row");
				}
				return row;
			});
			const replaceDraft = Effect.fn("PageAuthoringRepository.replaceDraft")(function* (
				userId: UserId,
				pageId: string,
				definition: PageDefinition,
				definitionHash: string,
				origin: PageOrigin,
			) {
				const [row] = yield* session.run((db) =>
					db
						.update(page)
						.set({
							origin,
							draftArtifactHash: null,
							draftDefinition: definition,
							draftCompiledRevision: null,
							draftDefinitionHash: definitionHash,
							draftRevision: sql`${page.draftRevision} + 1`,
							...(origin === "assistant"
								? { writeAccess: false, authorityRevision: sql`${page.authorityRevision} + 1` }
								: {}),
						})
						.where(owned(userId, pageId))
						.returning({ pageId: page.id, draftRevision: page.draftRevision }),
				);
				if (!row) {
					return yield* Effect.die("Locked page disappeared");
				}
				return row;
			});
			const recordBuild = Effect.fn("PageAuthoringRepository.recordBuild")(function* (
				userId: UserId,
				pageId: string,
				current: typeof page.$inferSelect,
				artifactHash: string,
				publish: boolean,
			) {
				yield* session.run((db) =>
					db
						.update(page)
						.set({
							draftArtifactHash: artifactHash,
							draftCompiledRevision: current.draftRevision,
							...(publish
								? {
										publishedArtifactHash: artifactHash,
										publishedRevision: current.draftRevision,
										publishedDefinition: current.draftDefinition,
										publishedDefinitionHash: current.draftDefinitionHash,
									}
								: {}),
						})
						.where(owned(userId, pageId)),
				);
			});
			const setWriteAccess = Effect.fn("PageAuthoringRepository.setWriteAccess")(function* (
				userId: UserId,
				pageId: string,
				writeAccess: boolean,
			) {
				yield* session.run((db) =>
					db
						.update(page)
						.set({ writeAccess, authorityRevision: sql`${page.authorityRevision} + 1` })
						.where(owned(userId, pageId)),
				);
				return { pageId };
			});
			const remove = Effect.fn("PageAuthoringRepository.remove")(function* (
				userId: UserId,
				pageId: string,
			) {
				yield* session
					.run((db) => db.delete(page).where(owned(userId, pageId)))
					.pipe(
						Effect.mapError((error) =>
							(error.code === "23001" || error.code === "23503") &&
							(error.constraint === "publication_page_owner_fk" ||
								(error.table === "saved_view" && error.constraint === "saved_view_page_owner_fk") ||
								error.constraint === `${error.table}_page_id_user_id_fkey`)
								? new PageAuthoringError({ reason: { code: "page-in-use" } })
								: error,
						),
					);
				return { pageId };
			});
			return {
				find,
				lock,
				create,
				remove,
				recordBuild,
				replaceDraft,
				setWriteAccess,
				findCompiledDraft,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
