import { unknownToMessage } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { eq, sql } from "drizzle-orm";
import { DateTime, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { AuthBootstrapError, AuthUserBootstrap } from "#modules/auth/service";
import { generateUserAvatar } from "#modules/auth/user-avatar";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { ClientSurfaceMaterializer } from "#modules/plugins/client-surface-materializer";
import { PluginInstallationService } from "#modules/plugins/installation-service";

import { PluginUserBootstrapDispatcher } from "./plugin-dispatch";

export const acquireBootstrapLock = Effect.fn(function* (userId: string) {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		db.execute(sql`select pg_advisory_xact_lock(hashtext(${`user:bootstrap:${userId}`}))`),
	);
});

const readBootstrapState = Effect.fn(function* (userId: string) {
	const session = yield* DatabaseSession;
	const [row] = yield* session.run((db) =>
		db
			.select({ image: schema.user.image, bootstrapCompletedAt: schema.user.bootstrapCompletedAt })
			.from(schema.user)
			.where(eq(schema.user.id, userId))
			.for("update"),
	);
	return row
		? { image: row.image, bootstrapCompletedAt: row.bootstrapCompletedAt }
		: { image: null, bootstrapCompletedAt: null };
});

const markBootstrapComplete = Effect.fn(function* (userId: string, image: string | null) {
	const session = yield* DatabaseSession;
	const completedAt = yield* DateTime.nowAsDate;
	yield* session.run((db) =>
		db
			.update(schema.user)
			.set(
				image === null
					? { bootstrapCompletedAt: completedAt }
					: { image, bootstrapCompletedAt: completedAt },
			)
			.where(eq(schema.user.id, userId)),
	);
});

export const performBootstrap = Effect.fn(function* (userId: string) {
	const user = UserId.make(userId);
	const session = yield* DatabaseSession;
	const alreadyComplete = yield* session.transaction(
		Effect.gen(function* () {
			yield* acquireBootstrapLock(userId);
			return (yield* readBootstrapState(userId)).bootstrapCompletedAt !== null;
		}),
	);
	if (alreadyComplete) {
		return;
	}
	const pluginBootstrap = yield* PluginUserBootstrapDispatcher;
	const pluginInstallations = yield* PluginInstallationService;
	yield* pluginInstallations.provisionSystemInstallations(user);
	yield* pluginBootstrap.dispatchAll(user);
	yield* (yield* ClientSurfaceMaterializer).materializeUserCompositions(user);
	yield* session.transaction(
		Effect.gen(function* () {
			yield* acquireBootstrapLock(userId);
			const state = yield* readBootstrapState(userId);
			if (state.bootstrapCompletedAt !== null) {
				return;
			}
			const notificationSubscriptions = yield* NotificationSubscriptionsService;
			yield* notificationSubscriptions.ensureDefaultRules(user);
			const avatar = state.image === null || state.image === "" ? generateUserAvatar(userId) : null;
			yield* markBootstrapComplete(userId, avatar);
		}),
	);
});

export const bootstrapNewUser = (userId: string) =>
	performBootstrap(userId).pipe(Effect.withSpan("bootstrapNewUser", { attributes: { userId } }));

export const AuthUserBootstrapLive = Layer.effect(
	AuthUserBootstrap,
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const pluginBootstrap = yield* PluginUserBootstrapDispatcher;
		const pluginInstallations = yield* PluginInstallationService;
		const notificationSubscriptions = yield* NotificationSubscriptionsService;
		const materializer = yield* ClientSurfaceMaterializer;

		return {
			run: (userId: string) =>
				bootstrapNewUser(userId).pipe(
					Effect.provideService(DatabaseSession, session),
					Effect.provideService(PluginInstallationService, pluginInstallations),
					Effect.provideService(PluginUserBootstrapDispatcher, pluginBootstrap),
					Effect.provideService(NotificationSubscriptionsService, notificationSubscriptions),
					Effect.provideService(ClientSurfaceMaterializer, materializer),
					Effect.mapError((error) => new AuthBootstrapError({ message: unknownToMessage(error) })),
				),
		};
	}),
);
