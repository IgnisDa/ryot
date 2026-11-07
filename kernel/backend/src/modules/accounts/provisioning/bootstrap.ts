import { DbError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { AuthRepository } from "#modules/accounts/auth/repository";
import { generateUserAvatar } from "#modules/accounts/auth/user-avatar";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { PluginInstallationService } from "#modules/plugins/installations/service";
import { DatabaseSession } from "#platform/db/session";

import { PluginUserBootstrapDispatcher } from "./plugin-dispatch";

export class UserBootstrap extends Context.Service<UserBootstrap>()(
	"@ryot-app/kernel-backend/modules/accounts/provisioning/bootstrap/UserBootstrap",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const accounts = yield* AuthRepository;
			const pluginBootstrap = yield* PluginUserBootstrapDispatcher;
			const pluginInstallations = yield* PluginInstallationService;
			const notificationSubscriptions = yield* NotificationSubscriptionsService;
			const admission = yield* AccountAdmission.make;

			const perform = Effect.fn("UserBootstrap.perform")(function* (
				userId: string,
				accountUserId: UserId,
			) {
				if (userId !== accountUserId) {
					return yield* new DbError({
						message: "Bootstrap account identity does not match its user",
					});
				}
				yield* Effect.annotateCurrentSpan({ userId });
				const user = UserId.make(userId);
				const shouldSkip = yield* session.transaction(
					Effect.gen(function* () {
						const state = yield* accounts.lockBootstrapState(userId);
						yield* admission.admitAccount(accountUserId);
						return state?.bootstrapCompletedAt !== null;
					}),
				);
				if (shouldSkip) {
					return [];
				}
				yield* pluginInstallations.provisionSystemInstallations(accountUserId);
				const plans = yield* pluginBootstrap.dispatchAll(user, accountUserId);
				yield* session.transaction(
					Effect.gen(function* () {
						const state = yield* accounts.lockBootstrapState(userId);
						yield* admission.admitAccount(accountUserId);
						if (state?.bootstrapCompletedAt !== null) {
							return;
						}
						yield* notificationSubscriptions.ensureDefaultRules(user);
						const avatar =
							state.image === null || state.image === "" ? generateUserAvatar(userId) : null;
						yield* accounts.markBootstrapComplete(userId, avatar);
					}),
				);
				return plans;
			});

			return { perform, listIncomplete: accounts.listIncompleteBootstraps };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
