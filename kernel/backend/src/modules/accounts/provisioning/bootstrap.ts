import { DbError } from "@ryot-app/contract/errors";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { AuthRepository } from "#modules/accounts/auth/repository";
import { generateUserAvatar } from "#modules/accounts/auth/user-avatar";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { MutationReceipts } from "#modules/mutations/receipts";
import { PluginInstallationService } from "#modules/plugins/installations/service";
import { DatabaseSession } from "#platform/db/session";

import { PluginUserBootstrapDispatcher } from "./plugin-dispatch";

export class UserBootstrap extends Context.Service<UserBootstrap>()("UserBootstrap", {
	make: Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const accounts = yield* AuthRepository;
		const pluginBootstrap = yield* PluginUserBootstrapDispatcher;
		const pluginInstallations = yield* PluginInstallationService;
		const notificationSubscriptions = yield* NotificationSubscriptionsService;
		const receipts = yield* MutationReceipts.make;

		const perform = Effect.fn("UserBootstrap.perform")(function* (
			userId: string,
			accountGeneration: AccountGeneration,
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
					const state = yield* accounts.lockBootstrapState(userId);
					return state?.bootstrapCompletedAt !== null;
				}),
			);
			if (shouldSkip) {
				return yield* Effect.void;
			}
			yield* pluginInstallations.provisionSystemInstallations(accountGeneration);
			yield* pluginBootstrap.dispatchAll(user, accountGeneration);
			yield* session.transaction(
				Effect.gen(function* () {
					yield* receipts.admitAccount(accountGeneration);
					const state = yield* accounts.lockBootstrapState(userId);
					if (state?.bootstrapCompletedAt !== null) {
						return;
					}
					yield* notificationSubscriptions.ensureDefaultRules(user);
					const avatar =
						state.image === null || state.image === "" ? generateUserAvatar(userId) : null;
					yield* accounts.markBootstrapComplete(userId, avatar);
				}),
			);
			return yield* Effect.void;
		});

		return { perform, listIncomplete: accounts.listIncompleteBootstraps };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
