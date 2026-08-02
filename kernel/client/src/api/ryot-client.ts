import { createRyotClient } from "@ryot/client-sdk";
import { Effect } from "effect";

import type { ThemeStore } from "../modules/theme/store";
import { AuthenticatedApi } from "./authenticated";
import type { ApiScope } from "./scope";

type AuthenticatedApiRuntime = {
	readonly runPromise: <A, E>(effect: Effect.Effect<A, E, AuthenticatedApi>) => Promise<A>;
};

export const createKernelRyotClient = (
	runtime: AuthenticatedApiRuntime,
	scope: ApiScope,
	theme: ThemeStore,
) =>
	createRyotClient({
		theme,
		query: (document) =>
			runtime.runPromise(
				AuthenticatedApi.pipe(
					Effect.flatMap((api) =>
						api.run(scope, (client) => client.ryotql.execute({ payload: document })),
					),
				),
			),
	});

export type KernelRyotClient = ReturnType<typeof createKernelRyotClient>;
