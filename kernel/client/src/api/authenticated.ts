import { runContract, type ContractProgram } from "@ryot/contract/client";
import { Context, Data, Effect, Layer } from "effect";

import { serverApiUrl } from "./origin";
import { canonicalApiScope, type ApiScope } from "./scope";

export class AuthenticatedApiError extends Data.TaggedError("AuthenticatedApiError")<{
	readonly cause: unknown;
}> {}

const runAuthenticated = <A, E>(scope: ApiScope, program: ContractProgram<A, E>) => {
	const canonical = canonicalApiScope(scope);
	return Effect.tryPromise({
		catch: (cause) => new AuthenticatedApiError({ cause }),
		try: (signal) =>
			runContract(program, {
				signal,
				credentials: "include",
				baseUrl: serverApiUrl(canonical.serverUrl),
			}),
	});
};

export class AuthenticatedApi extends Context.Service<
	AuthenticatedApi,
	{
		readonly run: <A, E>(
			scope: ApiScope,
			program: ContractProgram<A, E>,
		) => Effect.Effect<A, AuthenticatedApiError>;
	}
>()("AuthenticatedApi", { make: Effect.succeed({ run: runAuthenticated }) }) {
	static readonly layer = Layer.effect(this, this.make);
}
