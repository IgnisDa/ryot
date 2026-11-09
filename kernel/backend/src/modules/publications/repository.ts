import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { PublicationSource } from "@ryot-app/contract/modules/publications/schemas";
import type { PublicationId, PublicationLinkId, UserId } from "@ryot-app/contract/schema/brands";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import { entity } from "#schema/tables/entities";
import { publication, publicationLink } from "#schema/tables/publications";

type PublicationDetails = {
	readonly icon: string;
	readonly title: string;
	readonly showOwnerName: boolean;
	readonly source: PublicationSource;
	readonly description: null | string;
};

const locatorObjectsPath =
	'strict $.** ? (@.type() == "object" && @."type" == $type && @."key" == $key)';

export class PublicationsRepository extends Context.Service<PublicationsRepository>()(
	"@ryot-app/kernel-backend/modules/publications/repository/PublicationsRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;

			const findOwned = Effect.fn("PublicationsRepository.findOwned")(function* (
				userId: UserId,
				publicationId: PublicationId,
			) {
				const [row] = yield* session.run((db) =>
					db
						.select()
						.from(publication)
						.where(and(eq(publication.id, publicationId), eq(publication.userId, userId))),
				);
				return row ?? null;
			});

			const collectionExists = Effect.fn("PublicationsRepository.collectionExists")(function* (
				userId: UserId,
				collectionId: string,
			) {
				const [row] = yield* session.run((db) =>
					db
						.select({ id: entity.id })
						.from(entity)
						.where(
							and(
								eq(entity.id, collectionId),
								eq(entity.userId, userId),
								eq(entity.entitySchemaSlug, "collection"),
								isNull(entity.entitySchemaPluginId),
							),
						),
				);
				return row !== undefined;
			});

			const findForVisit = Effect.fn("PublicationsRepository.findForVisit")(function* (
				publicationId: PublicationId,
			) {
				const [row] = yield* session.run((db) =>
					db
						.select({
							publication,
							owner: {
								name: user.name,
								disabledAt: user.disabledAt,
								preferences: user.preferences,
							},
						})
						.from(publication)
						.innerJoin(user, eq(user.id, publication.userId))
						.where(eq(publication.id, publicationId)),
				);
				return row ?? null;
			});

			const insert = Effect.fn("PublicationsRepository.insert")(function* (
				userId: UserId,
				details: PublicationDetails,
			) {
				const [row] = yield* session.run((db) =>
					db
						.insert(publication)
						.values({ ...details, userId })
						.returning({ id: publication.id, revision: publication.revision }),
				);
				if (!row) {
					return yield* Effect.die(new Error("Publication insert returned no row"));
				}
				return row;
			});

			const republish = Effect.fn("PublicationsRepository.republish")(function* (
				userId: UserId,
				publicationId: PublicationId,
				details: PublicationDetails,
			) {
				const [row] = yield* session.run((db) =>
					db
						.update(publication)
						.set({ ...details, revision: sql`${publication.revision} + 1` })
						.where(
							and(
								eq(publication.id, publicationId),
								eq(publication.userId, userId),
								isNull(publication.revokedAt),
							),
						)
						.returning({ id: publication.id, revision: publication.revision }),
				);
				return row ?? null;
			});

			const revoke = Effect.fn("PublicationsRepository.revoke")(function* (
				userId: UserId,
				publicationId: PublicationId,
			) {
				const rows = yield* session.run((db) =>
					db
						.update(publication)
						.set({ revokedAt: sql`coalesce(${publication.revokedAt}, now())` })
						.where(and(eq(publication.id, publicationId), eq(publication.userId, userId)))
						.returning({ id: publication.id }),
				);
				return rows.length > 0;
			});

			const remove = Effect.fn("PublicationsRepository.remove")(function* (
				userId: UserId,
				publicationId: PublicationId,
			) {
				const rows = yield* session.run((db) =>
					db
						.delete(publication)
						.where(and(eq(publication.id, publicationId), eq(publication.userId, userId)))
						.returning({ id: publication.id }),
				);
				return rows.length > 0;
			});

			const insertLink = Effect.fn("PublicationsRepository.insertLink")(function* (input: {
				readonly label: string;
				readonly tokenHash: string;
				readonly expiresAt: null | Date;
				readonly publicationId: PublicationId;
			}) {
				const [row] = yield* session.run((db) =>
					db.insert(publicationLink).values(input).returning({ id: publicationLink.id }),
				);
				if (!row) {
					return yield* Effect.die(new Error("Publication link insert returned no row"));
				}
				return row.id;
			});

			const revokeLink = Effect.fn("PublicationsRepository.revokeLink")(function* (
				userId: UserId,
				linkId: PublicationLinkId,
			) {
				const rows = yield* session.run((db) =>
					db
						.update(publicationLink)
						.set({ revokedAt: sql`coalesce(${publicationLink.revokedAt}, now())` })
						.where(
							and(
								eq(publicationLink.id, linkId),
								inArray(
									publicationLink.publicationId,
									db
										.select({ id: publication.id })
										.from(publication)
										.where(eq(publication.userId, userId)),
								),
							),
						)
						.returning({ id: publicationLink.id }),
				);
				return rows.length > 0;
			});

			const findLinkByHash = Effect.fn("PublicationsRepository.findLinkByHash")(function* (
				tokenHash: string,
			) {
				const [row] = yield* session.run((db) =>
					db.select().from(publicationLink).where(eq(publicationLink.tokenHash, tokenHash)),
				);
				return row ?? null;
			});

			const findLink = Effect.fn("PublicationsRepository.findLink")(function* (
				linkId: PublicationLinkId,
			) {
				const [row] = yield* session.run((db) =>
					db.select().from(publicationLink).where(eq(publicationLink.id, linkId)),
				);
				return row ?? null;
			});

			const markLinkExchanged = Effect.fn("PublicationsRepository.markLinkExchanged")(function* (
				linkId: PublicationLinkId,
			) {
				yield* session.run((db) =>
					db
						.update(publicationLink)
						.set({ lastExchangedAt: sql`now()` })
						.where(eq(publicationLink.id, linkId)),
				);
			});

			const referencedAssets = Effect.fn("PublicationsRepository.referencedAssets")(function* (
				entityIds: ReadonlyArray<string>,
				locators: ReadonlyArray<ManagedAssetLocator>,
			) {
				if (entityIds.length === 0 || locators.length === 0) {
					return [];
				}
				const rows = yield* session.run((db) =>
					db.execute<{ key: string; type: string }>(
						sql`select locator.key, locator.type
							from jsonb_to_recordset(${JSON.stringify(locators)}::jsonb) as locator(key text, type text)
							where exists (
								select 1 from ${entity}
								where ${entity.id} in (select value from jsonb_array_elements_text(${JSON.stringify(entityIds)}::jsonb))
								and jsonb_path_exists(${entity.properties}, ${locatorObjectsPath}::jsonpath,
									jsonb_build_object('key', locator.key, 'type', locator.type))
							)`,
						"objects",
					),
				);
				const found = new Set(rows.map(({ key, type }) => `${type}\0${key}`));
				return locators.filter(({ key, type }) => found.has(`${type}\0${key}`));
			});

			return {
				insert,
				revoke,
				remove,
				findLink,
				findOwned,
				republish,
				insertLink,
				revokeLink,
				findForVisit,
				findLinkByHash,
				collectionExists,
				referencedAssets,
				markLinkExchanged,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
