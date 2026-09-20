import { DbError } from "@ryot-app/contract/errors";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { UserId } from "@ryot-app/contract/schema/brands";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { generateUserAvatar } from "#modules/auth/user-avatar";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { MutationReceipts } from "#modules/mutations/receipts";
import { PluginInstallationService } from "#modules/plugins/installation-service";

import { PluginUserBootstrapDispatcher } from "./plugin-dispatch";

export class UserBootstrap extends Context.Service<UserBootstrap>()("UserBootstrap", {
	make: Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const pluginBootstrap = yield* PluginUserBootstrapDispatcher;
		const pluginInstallations = yield* PluginInstallationService;
		const notificationSubscriptions = yield* NotificationSubscriptionsService;
		const receipts = yield* MutationReceipts.make;

		const acquireBootstrapLock = (userId: string) =>
			session.run((db) =>
				db.execute(sql`select pg_advisory_xact_lock(hashtext(${`user:bootstrap:${userId}`}))`),
			);

		const readBootstrapState = Effect.fn(function* (userId: string) {
			const [row] = yield* session.run((db) =>
				db
					.select({
						image: schema.user.image,
						bootstrapCompletedAt: schema.user.bootstrapCompletedAt,
					})
					.from(schema.user)
					.where(eq(schema.user.id, userId))
					.for("update"),
			);
			return row ? { image: row.image, bootstrapCompletedAt: row.bootstrapCompletedAt } : null;
		});
		const listIncomplete = Effect.fn("UserBootstrap.listIncomplete")(function* (limit: number) {
			return yield* session.run((db) =>
				db
					.select({ id: schema.user.id })
					.from(schema.user)
					.where(isNull(schema.user.bootstrapCompletedAt))
					.orderBy(asc(schema.user.createdAt))
					.limit(limit),
			);
		});

		const markBootstrapComplete = Effect.fn(function* (userId: string, image: string | null) {
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

		const perform = Effect.fn("UserBootstrap.perform")(function* (
			userId: string,
			accountGeneration: AccountGeneration,
			generation?: string,
		) {
			if (userId !== accountGeneration.userId) {
				return yield* new DbError({
					message: "Bootstrap account identity does not match its user",
				});
			}
			yield* Effect.annotateCurrentSpan({ userId });
			const user = UserId.make(userId);
			const shouldSkip = yield* session.transaction(
				Effect.gen(function* () {
					yield* receipts.admitAccount(accountGeneration);
					yield* acquireBootstrapLock(userId);
					const state = yield* readBootstrapState(userId);
					return state?.bootstrapCompletedAt !== null;
				}),
			);
			if (shouldSkip) {
				return yield* Effect.void;
			}
			yield* pluginInstallations.provisionSystemInstallations(accountGeneration);
			yield* pluginBootstrap.dispatchAll(user, accountGeneration, generation);
			yield* session.transaction(
				Effect.gen(function* () {
					yield* receipts.admitAccount(accountGeneration);
					yield* acquireBootstrapLock(userId);
					const state = yield* readBootstrapState(userId);
					if (state?.bootstrapCompletedAt !== null) {
						return;
					}
					yield* notificationSubscriptions.ensureDefaultRules(user);
					const avatar =
						state.image === null || state.image === "" ? generateUserAvatar(userId) : null;
					yield* markBootstrapComplete(userId, avatar);
				}),
			);
			return yield* Effect.void;
		});

		return { perform, listIncomplete };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
