import { UserId } from "@ryot/contract/schema/brands";
import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect, TransactionRunner } from "#lib/infrastructure/db/service";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";

import { PluginUserBootstrapDispatcher } from "./plugin-dispatch";

export const acquireBootstrapLock = Effect.fn(function* (userId: string) {
	const db = yield* CurrentDb;
	yield* dbEffect(() =>
		db.execute(sql`select pg_advisory_xact_lock(hashtext(${`user:bootstrap:${userId}`}))`),
	);
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
	const runner = yield* TransactionRunner;
	const alreadyComplete = yield* runner(
		Effect.gen(function* () {
			yield* acquireBootstrapLock(userId);
			return (yield* readBootstrapMarker(userId)) !== null;
		}),
	);
	if (alreadyComplete) {
		return;
	}
	const pluginBootstrap = yield* PluginUserBootstrapDispatcher;
	yield* pluginBootstrap.dispatchAll(user);
	yield* runner(
		Effect.gen(function* () {
			yield* acquireBootstrapLock(userId);
			if ((yield* readBootstrapMarker(userId)) !== null) {
				return;
			}
			const notificationSubscriptions = yield* NotificationSubscriptionsService;
			yield* notificationSubscriptions.ensureDefaultRules(user);
			yield* markBootstrapComplete(userId);
		}),
	);
});

export const bootstrapNewUser = (userId: string) =>
	performBootstrap(userId).pipe(Effect.withSpan("bootstrapNewUser", { attributes: { userId } }));
