import { DbError } from "@ryot-app/contract/errors";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { EntityId, type UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { AuthRepository } from "#modules/auth/repository";
import { entityVisibleToUserClause } from "#modules/entities/repository-support";

export type TranslationOverlayInput = {
	language: string;
	populatedAt: Date;
	entityId: EntityId;
	name: string | null;
	properties: Record<string, unknown> | null;
};

export class TranslationsRepository extends Context.Service<TranslationsRepository>()(
	"TranslationsRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const auth = yield* AuthRepository;
			const findEntityById = Effect.fn("TranslationsRepository.findEntityById")(function* (
				entityId: EntityId,
				lock = false,
			) {
				const [row] = yield* session.run((db) => {
					const query = db
						.select()
						.from(schema.entity)
						.where(eq(schema.entity.id, entityId))
						.limit(1);
					return lock ? query.for("update") : query;
				});
				return row ?? null;
			});
			const lockActivePluginOwner = Effect.fn("TranslationsRepository.lockActivePluginOwner")(
				function* (pluginId: string) {
					yield* session.requireTransaction.pipe(
						Effect.mapError(
							() => new DbError({ message: "Translation authority requires a transaction" }),
						),
					);
					yield* session.run((db) =>
						db.execute(
							sql`select pg_advisory_xact_lock_shared(hashtext(${`plugin-config:${pluginId}`}))`,
						),
					);
					const [row] = yield* session.run((db) =>
						db
							.select({ ownerId: schema.plugin.ownerId })
							.from(schema.plugin)
							.where(and(eq(schema.plugin.id, pluginId), eq(schema.plugin.status, "active")))
							.limit(1),
					);
					return row ?? null;
				},
			);
			const requireActiveAccount = Effect.fn("TranslationsRepository.requireActiveAccount")(
				function* (userId: UserId, generation: AccountGeneration | null) {
					const [account] = yield* session.run((db) =>
						db
							.select({ disabledAt: schema.user.disabledAt, token: schema.user.accountGeneration })
							.from(schema.user)
							.where(eq(schema.user.id, userId))
							.limit(1)
							.for("share"),
					);
					if (
						account?.disabledAt !== null ||
						(generation !== null &&
							(generation.userId !== userId || generation.token !== account.token))
					) {
						return yield* new DbError({ message: "Translation account authority is unavailable" });
					}
					return yield* Effect.void;
				},
			);
			const findEntityForUser = Effect.fn("TranslationsRepository.findEntityForUser")(function* (
				input: { entityId: EntityId; userId: UserId },
				lock = false,
			) {
				const [row] = yield* session.run((db) => {
					const query = db
						.select()
						.from(schema.entity)
						.where(
							and(eq(schema.entity.id, input.entityId), entityVisibleToUserClause(input.userId)),
						)
						.limit(1);
					return lock ? query.for("update") : query;
				});
				return row ?? null;
			});
			const listForBackup = Effect.fn("TranslationsRepository.listForBackup")(function* (
				entityIds: ReadonlyArray<EntityId>,
			) {
				if (entityIds.length === 0) {
					return [];
				}
				return yield* session.run((db) =>
					db
						.select()
						.from(schema.entityTranslation)
						.where(inArray(schema.entityTranslation.entityId, [...entityIds]))
						.orderBy(
							asc(schema.entityTranslation.entityId),
							asc(schema.entityTranslation.language),
						),
				);
			});

			const upsertOverlay = Effect.fn("TranslationsRepository.upsertOverlay")(function* (
				input: TranslationOverlayInput,
			) {
				const [row] = yield* session.run((db) =>
					db
						.insert(schema.entityTranslation)
						.values({
							name: input.name,
							entityId: input.entityId,
							language: input.language,
							properties: input.properties,
							populatedAt: input.populatedAt,
						})
						.onConflictDoUpdate({
							target: [schema.entityTranslation.entityId, schema.entityTranslation.language],
							set: {
								updatedAt: sql`now()`,
								name: sql`excluded.name`,
								properties: sql`excluded.properties`,
								populatedAt: sql`excluded.populated_at`,
							},
						})
						.returning({
							entityId: schema.entityTranslation.entityId,
							language: schema.entityTranslation.language,
						}),
				);
				if (!row) {
					return yield* new DbError({ message: "Translation overlay upsert returned no row" });
				}
				return { language: row.language, entityId: EntityId.make(row.entityId) };
			});

			const findUserLanguage = Effect.fn("TranslationsRepository.findUserLanguage")(function* (
				userId: UserId,
			) {
				return (yield* auth.getUserPreferences(userId))?.language ?? null;
			});

			return {
				upsertOverlay,
				listForBackup,
				findEntityById,
				findUserLanguage,
				findEntityForUser,
				requireActiveAccount,
				lockActivePluginOwner,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(AuthRepository.layer));
}
