import { runContract, type ContractProgram } from "@ryot/contract/client";
import { Context, Data, Effect, Layer } from "effect";

import { serverApiUrl } from "#/api/origin";
import { canonicalApiScope, type ApiScope } from "#/api/scope";
import { ClientStorage } from "#/persistence/storage";

export class AuthenticatedApiError extends Data.TaggedError("AuthenticatedApiError")<{
	readonly cause: unknown;
}> {}

export class AuthenticatedApi extends Context.Service<
	AuthenticatedApi,
	{
		readonly run: <A, E>(
			scope: ApiScope,
			program: ContractProgram<A, E>,
		) => Effect.Effect<A, AuthenticatedApiError>;
	}
>()("AuthenticatedApi", {
	make: Effect.gen(function* () {
		const storage = yield* ClientStorage;
		const run = <A, E>(scope: ApiScope, program: ContractProgram<A, E>) =>
			Effect.gen(function* () {
				const canonical = canonicalApiScope(scope);
				const token = yield* storage.getSessionToken(canonical.serverUrl);
				return yield* Effect.tryPromise({
					catch: (cause) => new AuthenticatedApiError({ cause }),
					try: (signal) =>
						runContract(program, {
							signal,
							baseUrl: serverApiUrl(canonical.serverUrl),
							...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
						}),
				});
			});

		return { run };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
