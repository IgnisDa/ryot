import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import { serverApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";

export const entityInterestSocketUrl = (scope: ApiScope) => {
	const url = new URL(`${serverApiUrl(scope.serverUrl)}/entity-interest/ws`);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url.toString();
};

export class EntityInterestApi extends Context.Service<EntityInterestApi>()("EntityInterestApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		return {
			createSocketTicket: (scope: ApiScope) =>
				api.run(scope, (client) => client["entity-interest"].createSocketTicket()),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
