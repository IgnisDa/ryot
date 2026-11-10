import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class EventsApi extends Context.Service<EventsApi>()(
	"@ryot-app/kernel-client/api/events/EventsApi",
	{
		make: Effect.gen(function* () {
			const api = yield* AuthenticatedApi;
			return {
				create: (scope: ApiScope, request: ContractRequest<"events", "create">) =>
					api.run(scope, (client) => client.events.create(request)),
				update: (scope: ApiScope, request: ContractRequest<"events", "update">) =>
					api.run(scope, (client) => client.events.update(request)),
				delete: (scope: ApiScope, request: ContractRequest<"events", "delete">) =>
					api.run(scope, (client) => client.events.delete(request)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
