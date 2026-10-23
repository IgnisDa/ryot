import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class CalendarSourcesApi extends Context.Service<CalendarSourcesApi>()(
	"CalendarSourcesApi",
	{
		make: Effect.gen(function* () {
			const api = yield* AuthenticatedApi;
			return {
				setVisibility: (
					scope: ApiScope,
					request: ContractRequest<"calendarSources", "setVisibility">,
				) => api.run(scope, (client) => client.calendarSources.setVisibility(request)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
