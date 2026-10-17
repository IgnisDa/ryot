import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class NotificationsApi extends Context.Service<NotificationsApi>()("NotificationsApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		return {
			testChannels: (scope: ApiScope) =>
				api.run(scope, (client) => client.notifications.testChannels()),
			createChannel: (
				scope: ApiScope,
				request: ContractRequest<"notifications", "createChannel">,
			) => api.run(scope, (client) => client.notifications.createChannel(request)),
			updateChannel: (
				scope: ApiScope,
				request: ContractRequest<"notifications", "updateChannel">,
			) => api.run(scope, (client) => client.notifications.updateChannel(request)),
			deleteChannel: (
				scope: ApiScope,
				request: ContractRequest<"notifications", "deleteChannel">,
			) => api.run(scope, (client) => client.notifications.deleteChannel(request)),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
