import { createRyotClient, RyotClientError } from "@ryot-app/client-sdk";
import { Effect } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import { classifyRyotQLFailure } from "#/api/ryotql";
import type { ApiScope } from "#/api/scope";
import type { ThemeStore } from "#/modules/theme/store";

type AuthenticatedApiRuntime = {
	readonly runPromise: <A, E>(
		effect: Effect.Effect<A, E, AuthenticatedApi>,
		options?: Effect.RunOptions,
	) => Promise<A>;
};

export const createKernelRyotClient = (
	runtime: AuthenticatedApiRuntime,
	scope: ApiScope,
	theme: ThemeStore,
) =>
	createRyotClient({
		theme,
		query: async (document, signal) => {
			try {
				return await runtime.runPromise(
					AuthenticatedApi.pipe(
						Effect.flatMap((api) =>
							api.run(scope, (client) => client.ryotql.execute({ payload: document })),
						),
					),
					{ signal },
				);
			} catch (error) {
				if (signal?.aborted) {
					throw signal.reason;
				}
				throw new RyotClientError(classifyRyotQLFailure(error));
			}
		},
	});

export type KernelRyotClient = ReturnType<typeof createKernelRyotClient>;
