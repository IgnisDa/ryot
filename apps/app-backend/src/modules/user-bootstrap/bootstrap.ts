import { DbError } from "@ryot/contract/errors";
import { EntitySchemaSlug, UserId } from "@ryot/contract/schema/brands";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect, TransactionRunner } from "#lib/infrastructure/db/service";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesService } from "#modules/entities/service";

export const acquireBootstrapLock = Effect.fn(function* (userId: string) {
	const db = yield* CurrentDb;
	yield* dbEffect(() =>
		db.execute(sql`select pg_advisory_xact_lock(hashtext(${`user:bootstrap:${userId}`}))`),
	);
});

const ensureLibraryEntity = Effect.fn(function* (userId: UserId) {
	const db = yield* CurrentDb;
	const definitions = yield* DefinitionRegistry;
	const entities = yield* EntitiesService;
	const library = definitions.getEntitySchema("library");
	if (!library) {
		return;
	}
	const slug = EntitySchemaSlug.make(library.slug);
	const [existing] = yield* dbEffect(() =>
		db
			.select({ id: schema.entity.id })
			.from(schema.entity)
			.where(
				and(
					eq(schema.entity.userId, userId),
					eq(schema.entity.entitySchemaSlug, slug),
					isNull(schema.entity.externalId),
					isNull(schema.entity.sandboxScriptId),
				),
			)
			.limit(1),
	);
	if (!existing) {
		yield* entities
			.create({
				userId,
				scope: "user",
				properties: {},
				name: "Library",
				origin: { kind: "bootstrap" },
				entitySchemaSlug: slug,
			})
			.pipe(
				Effect.mapError((error) =>
					error._tag === "NotFound" ? new DbError({ message: error.message }) : error,
				),
			);
	}
});

const readBootstrapMarker = Effect.fn(function* (userId: string) {
	const db = yield* CurrentDb;
	const [row] = yield* dbEffect(() =>
		db
			.select({ bootstrapCompletedAt: schema.user.bootstrapCompletedAt })
			.from(schema.user)
			.where(eq(schema.user.id, userId))
			.for("update"),
	);
	return row?.bootstrapCompletedAt ?? null;
});

const markBootstrapComplete = Effect.fn(function* (userId: string) {
	const db = yield* CurrentDb;
	yield* dbEffect(() =>
		db
			.update(schema.user)
			.set({ bootstrapCompletedAt: new Date() })
			.where(eq(schema.user.id, userId)),
	);
});

export const performBootstrap = Effect.fn(function* (userId: string) {
	const user = UserId.make(userId);
	yield* acquireBootstrapLock(userId);
	if ((yield* readBootstrapMarker(userId)) !== null) {
		return;
	}
	yield* ensureLibraryEntity(user);
	const notificationSubscriptions = yield* NotificationSubscriptionsService;
	yield* notificationSubscriptions.ensureDefaultRules(user);
	yield* markBootstrapComplete(userId);
});

export const bootstrapNewUser = (userId: string) =>
	Effect.gen(function* () {
		const runner = yield* TransactionRunner;
		yield* runner(performBootstrap(userId));
	}).pipe(Effect.withSpan("bootstrapNewUser", { attributes: { userId } }));
