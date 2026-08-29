import { createRyotClient, RyotClientError } from "@ryot-app/client-sdk";
import { Effect } from "effect";

import { classifyRyotQLFailure, RyotQLApi } from "#/api/ryotql";
import { apiScopeKey, type ApiScope } from "#/api/scope";
import { UploadsApi } from "#/api/uploads";
import {
	classifyManagedAssetFailure,
	mapManagedAssetResolutions,
} from "#/modules/assets/managed-assets";
import {
	classifyTemporaryUploadFailure,
	temporaryUpload,
} from "#/modules/assets/temporary-uploads";
import { EntityInterestService } from "#/modules/entity-interest/service";
import type { ThemeStore } from "#/modules/theme/store";

type KernelApiRuntime = {
	readonly runSync: <A>(effect: Effect.Effect<A, never, EntityInterestService>) => A;
	readonly runPromise: <A, E>(
		effect: Effect.Effect<A, E, RyotQLApi | UploadsApi>,
		options?: Effect.RunOptions,
	) => Promise<A>;
};

export const createKernelRyotClient = (
	runtime: KernelApiRuntime,
	scope: ApiScope,
	theme: ThemeStore,
) => {
	return createRyotClient({
		theme,
		watchEntities: (interest, onUpdate) =>
			runtime.runSync(
				Effect.map(EntityInterestService, (service) => service.watch(scope, interest, onUpdate)),
			),
		uploadTemporary: async (request) => {
			try {
				return await runtime.runPromise(temporaryUpload(scope, request));
			} catch (error) {
				throw new RyotClientError(classifyTemporaryUploadFailure(error));
			}
		},
		resolveAssets: async (assets, signal) => {
			try {
				const response = await runtime.runPromise(
					UploadsApi.pipe(
						Effect.flatMap((api) =>
							api.resolveDownloads(scope, { payload: { assets: [...assets] } }),
						),
					),
					{ signal },
				);
				return mapManagedAssetResolutions(scope, response);
			} catch (error) {
				if (signal?.aborted) {
					throw signal.reason;
				}
				throw new RyotClientError(classifyManagedAssetFailure(error));
			}
		},
		query: async (document, signal) => {
			try {
				return await runtime.runPromise(
					RyotQLApi.pipe(Effect.flatMap((api) => api.execute(scope, { payload: document }))),
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
};

export type KernelRyotClient = ReturnType<typeof createKernelRyotClient>;

export type KernelRyotClientStore = {
	readonly get: (scope: ApiScope) => KernelRyotClient;
};

export const createKernelRyotClientStore = (
	runtime: KernelApiRuntime,
	theme: ThemeStore,
): KernelRyotClientStore => {
	const clients = new Map<string, KernelRyotClient>();
	return {
		get: (scope) => {
			const key = apiScopeKey(scope);
			const existing = clients.get(key);
			if (existing !== undefined) {
				return existing;
			}
			const client = createKernelRyotClient(runtime, scope, theme);
			clients.set(key, client);
			return client;
		},
	};
};
