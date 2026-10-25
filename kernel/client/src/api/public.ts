import { type ContractProgram, makeContractClient } from "@ryot-app/contract/client";
import type { SystemConfigResponse } from "@ryot-app/contract/modules/system/contract";
import { Context, Effect, Layer, Schema } from "effect";
import { HttpClient } from "effect/http";

import { serverApiUrl, type ServerOrigin } from "#/api/origin";

export class PublicApiError extends Schema.TaggedError<
	PublicApiError,
	{ readonly brand: unique symbol }
>()("PublicApiError", { cause: Schema.Unknown }) {}

const makePublicApi = (http: HttpClient.HttpClient) => {
	const run = <A, E>(origin: ServerOrigin, program: ContractProgram<A, E>) =>
		makeContractClient(serverApiUrl(origin)).pipe(
			Effect.flatMap(program),
			Effect.provideService(HttpClient.HttpClient, http),
			Effect.mapError((cause) => new PublicApiError({ cause })),
		);
	return {
		getSystemConfig: (origin: ServerOrigin) => run(origin, (client) => client.system.config()),
		checkHealth: Effect.fn("PublicApi.checkHealth")(function* (origin: ServerOrigin) {
			yield* run(origin, (client) => client.system.health());
		}),
	};
};

export class PublicApi extends Context.Service<
	PublicApi,
	{
		readonly checkHealth: (origin: ServerOrigin) => Effect.Effect<void, PublicApiError>;
		readonly getSystemConfig: (
			origin: ServerOrigin,
		) => Effect.Effect<SystemConfigResponse, PublicApiError>;
	}
>()("@ryot-app/kernel-client/api/public/PublicApi", {
	make: Effect.map(HttpClient.HttpClient, makePublicApi),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
