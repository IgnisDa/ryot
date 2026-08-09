import {
	runContract,
	type ContractProgram,
	type RunContractOptions,
} from "@ryot-app/contract/client";
import { Context, Data, Effect, Layer } from "effect";

import { serverApiUrl, type ServerOrigin } from "#/api/origin";

export class AdminApiError extends Data.TaggedError("AdminApiError")<{
	readonly cause: unknown;
}> {}

type ContractRunner = <A, E>(
	program: ContractProgram<A, E>,
	options: RunContractOptions,
) => Promise<A>;

export type AdminApiService = {
	readonly run: <A, E>(
		origin: ServerOrigin,
		token: string,
		program: ContractProgram<A, E>,
	) => Effect.Effect<A, AdminApiError>;
};

export const makeAdminApi = (runner: ContractRunner = runContract): AdminApiService => ({
	run: <A, E>(origin: ServerOrigin, token: string, program: ContractProgram<A, E>) =>
		Effect.tryPromise({
			catch: (cause) => new AdminApiError({ cause }),
			try: (signal) =>
				runner(program, {
					signal,
					baseUrl: serverApiUrl(origin),
					headers: { "Admin-Access-Token": token },
				}),
		}),
});

export class AdminApi extends Context.Service<AdminApi, AdminApiService>()("AdminApi", {
	make: Effect.succeed(makeAdminApi()),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
