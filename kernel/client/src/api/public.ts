import { runContract } from "@ryot-app/contract/client";
import type { SystemConfigResponse } from "@ryot-app/contract/modules/system/contract";
import { Context, Data, Effect, Layer } from "effect";

import { serverApiUrl, type ServerOrigin } from "#/api/origin";

export class PublicApiError extends Data.TaggedError("PublicApiError")<{
	readonly cause: unknown;
}> {}

const checkHealth = Effect.fn("PublicApi.checkHealth")(function* (origin: ServerOrigin) {
	yield* Effect.tryPromise({
		catch: (cause) => new PublicApiError({ cause }),
		try: (signal) =>
			runContract((client) => client.system.health(), { baseUrl: serverApiUrl(origin), signal }),
	});
});

const getSystemConfig = (origin: ServerOrigin) =>
	Effect.tryPromise({
		catch: (cause) => new PublicApiError({ cause }),
		try: (signal) =>
			runContract((client) => client.system.config(), { signal, baseUrl: serverApiUrl(origin) }),
	});

export class PublicApi extends Context.Service<
	PublicApi,
	{
		readonly checkHealth: (origin: ServerOrigin) => Effect.Effect<void, PublicApiError>;
		readonly getSystemConfig: (
			origin: ServerOrigin,
		) => Effect.Effect<SystemConfigResponse, PublicApiError>;
	}
>()("PublicApi", { make: Effect.succeed({ checkHealth, getSystemConfig }) }) {
	static readonly layer = Layer.effect(this, this.make);
}
