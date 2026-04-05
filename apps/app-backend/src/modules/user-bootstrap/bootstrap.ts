import { UserId } from "@ryot/contract/schema/brands";
import { eq, sql } from "drizzle-orm";
import { DateTime, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { AuthUserBootstrap } from "#modules/auth/service";
import { generateUserAvatar } from "#modules/auth/user-avatar";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { SavedViewsService } from "#modules/saved-views/service";

import { PluginUserBootstrapDispatcher } from "./plugin-dispatch";

export const acquireBootstrapLock = Effect.fn(function* (userId: string) {
	const db = yield* Database;
	yield* mapDatabaseErrors(
		db.execute(sql`select pg_advisory_xact_lock(hashtext(${`user:bootstrap:${userId}`}))`),
	);
});

const readBootstrapState = Effect.fn(function* (userId: string) {
	const db = yield* Database;
	const [row] = yield* mapDatabaseErrors(
		db
			.select({ image: schema.user.image, bootstrapCompletedAt: schema.user.bootstrapCompletedAt })
			.from(schema.user)
			.where(eq(schema.user.id, userId))
			.for("update"),
	);
	return row
		? { bootstrapCompletedAt: row.bootstrapCompletedAt, image: row.image }
		: { bootstrapCompletedAt: null, image: null };
});

const markBootstrapComplete = Effect.fn(function* (userId: string, image: string | null) {
	const db = yield* Database;
	const completedAt = yield* DateTime.nowAsDate;
	yield* mapDatabaseErrors(
		db
			.update(schema.user)
			.set(
				image === null
					? { bootstrapCompletedAt: completedAt }
					: { bootstrapCompletedAt: completedAt, image },
			)
			.where(eq(schema.user.id, userId)),
	);
});

export const performBootstrap = Effect.fn(function* (userId: string) {
	const user = UserId.make(userId);
	const database = yield* Database;
	const alreadyComplete = yield* mapDatabaseErrors(
		database.transaction((transaction) =>
			Effect.gen(function* () {
				yield* acquireBootstrapLock(userId);
				return (yield* readBootstrapState(userId)).bootstrapCompletedAt !== null;
			}).pipe(Effect.provideService(Database, transaction)),
		),
	);
	if (alreadyComplete) {
		return;
	}
	const savedViews = yield* SavedViewsService;
	const pluginBootstrap = yield* PluginUserBootstrapDispatcher;
	yield* pluginBootstrap.dispatchAll(user);
	yield* mapDatabaseErrors(
		database.transaction((transaction) =>
			Effect.gen(function* () {
				yield* acquireBootstrapLock(userId);
				const state = yield* readBootstrapState(userId);
				if (state.bootstrapCompletedAt !== null) {
					return;
				}
				yield* savedViews.ensureBuiltinViews(user);
				const notificationSubscriptions = yield* NotificationSubscriptionsService;
				yield* notificationSubscriptions.ensureDefaultRules(user);
				const avatar =
					state.image === null || state.image === "" ? generateUserAvatar(userId) : null;
				yield* markBootstrapComplete(userId, avatar);
			}).pipe(Effect.provideService(Database, transaction)),
		),
	);
});

export const bootstrapNewUser = (userId: string) =>
	performBootstrap(userId).pipe(Effect.withSpan("bootstrapNewUser", { attributes: { userId } }));

export const AuthUserBootstrapLive = Layer.effect(
	AuthUserBootstrap,
	Effect.gen(function* () {
		const database = yield* Database;
		const savedViews = yield* SavedViewsService;
		const pluginBootstrap = yield* PluginUserBootstrapDispatcher;
		const notificationSubscriptions = yield* NotificationSubscriptionsService;

		return {
			run: (userId: string) =>
				bootstrapNewUser(userId).pipe(
					Effect.provideService(Database, database),
					Effect.provideService(PluginUserBootstrapDispatcher, pluginBootstrap),
					Effect.provideService(NotificationSubscriptionsService, notificationSubscriptions),
					Effect.provideService(SavedViewsService, savedViews),
				),
		};
	}),
);
