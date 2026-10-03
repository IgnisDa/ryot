import { makeContractClient, type ContractProgram } from "@ryot-app/contract/client";
import type { SystemConfigResponse } from "@ryot-app/contract/modules/system/contract";
import { Context, Data, Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";

import { serverApiUrl, type ServerOrigin } from "#/api/origin";

export class PublicApiError extends Data.TaggedError("PublicApiError")<{
	readonly cause: unknown;
}> {}

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
>()("PublicApi", { make: Effect.map(HttpClient.HttpClient, makePublicApi) }) {
	static readonly layer = Layer.effect(this, this.make);
}
