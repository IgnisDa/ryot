import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class RemindersApi extends Context.Service<RemindersApi>()(
	"@ryot-app/kernel-client/api/reminders/RemindersApi",
	{
		make: Effect.gen(function* () {
			const api = yield* AuthenticatedApi;
			return {
				deliveryConfiguration: (scope: ApiScope) =>
					api.run(scope, (client) => client.reminders.deliveryConfiguration()),
				edit: (scope: ApiScope, request: ContractRequest<"reminders", "edit">) =>
					api.run(scope, (client) => client.reminders.edit(request)),
				create: (scope: ApiScope, request: ContractRequest<"reminders", "create">) =>
					api.run(scope, (client) => client.reminders.create(request)),
				cancel: (scope: ApiScope, request: ContractRequest<"reminders", "cancel">) =>
					api.run(scope, (client) => client.reminders.cancel(request)),
				remove: (scope: ApiScope, request: ContractRequest<"reminders", "remove">) =>
					api.run(scope, (client) => client.reminders.remove(request)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
