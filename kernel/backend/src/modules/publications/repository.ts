import type { PublicationSource } from "@ryot-app/contract/modules/publications/schemas";
import type { PublicationId, PublicationLinkId, UserId } from "@ryot-app/contract/schema/brands";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import { publication, publicationLink } from "#schema/tables/publications";

type PublicationDetails = {
	readonly icon: string;
	readonly title: string;
	readonly showOwnerName: boolean;
	readonly source: PublicationSource;
	readonly description: null | string;
};

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
				markLinkExchanged,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
