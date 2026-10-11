import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import { serverApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";

export const entityWatchSocketUrl = (scope: ApiScope) => {
	const url = new URL(`${serverApiUrl(scope.serverUrl)}/entity-watches/ws`);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url.toString();
};

export class EntityWatchApi extends Context.Service<EntityWatchApi>()("EntityWatchApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		return {
			createSocketTicket: (scope: ApiScope) =>
				api.run(scope, (client) => client["entity-watches"].createSocketTicket()),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
