import { type ContractProgram, makeContractClient } from "@ryot-app/contract/client";
import type { SystemConfigResponse } from "@ryot-app/contract/modules/system/contract";
import { Context, Effect, Layer, Schema } from "effect";
import { HttpClient } from "effect/http";

import { serverApiUrl, type ServerOrigin } from "#/api/origin";

export class PublicApiError extends Schema.TaggedError<
	PublicApiError,
	{ readonly brand: unique symbol }
>()("PublicApiError", { cause: Schema.Unknown }) {}

export const runServerContract = <A, E>(
	http: HttpClient.HttpClient,
	origin: ServerOrigin,
	headers: Record<string, string>,
	program: ContractProgram<A, E>,
) =>
	makeContractClient(serverApiUrl(origin), headers).pipe(
		Effect.flatMap(program),
		Effect.provideService(HttpClient.HttpClient, http),
	);

const makePublicApi = (http: HttpClient.HttpClient) => {
	const run = <A, E>(origin: ServerOrigin, program: ContractProgram<A, E>) =>
		runServerContract(http, origin, {}, program).pipe(
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
