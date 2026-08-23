import { createRyotClient, RyotClientError } from "@ryot-app/client-sdk";
import { makeRyotRuntime, type RyotRuntime } from "@ryot-app/client-sdk/schedule";
import { Effect } from "effect";

import { classifyCollectionFailure, CollectionsApi } from "#/api/collections";
import { classifyRyotQLFailure, RyotQLApi } from "#/api/ryotql";
import { apiScopeKey, type ApiScope } from "#/api/scope";
import { UploadsApi } from "#/api/uploads";
import type { KernelHostServices } from "#/host-services";
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
import type { ClientRuntime } from "#/runtime";

type KernelApiRuntime = {
	readonly runSync: <A>(effect: Effect.Effect<A, never, EntityInterestService>) => A;
	readonly runPromise: <A, E>(
		effect: Effect.Effect<A, E, CollectionsApi | RyotQLApi | UploadsApi>,
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
		mutateCollection: async (request) => {
			try {
				return await runtime.runPromise(
					CollectionsApi.pipe(
						Effect.flatMap((api) => {
							if (request.action === "create") {
								return api
									.create(scope, { payload: request.input })
									.pipe(Effect.map((value): unknown => value));
							}
							if (request.action === "upsert-membership") {
								return api
									.createMembership(scope, { payload: request.input })
									.pipe(Effect.map((value): unknown => value));
							}
							return api
								.deleteMembership(scope, { payload: request.input })
								.pipe(Effect.map((value): unknown => value));
						}),
					),
				);
			} catch (error) {
				throw new RyotClientError(classifyCollectionFailure(error));
			}
		},
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

export type KernelRyotSession = {
	readonly runtime: RyotRuntime;
	readonly client: KernelRyotClient;
	readonly hostServices: KernelHostServices;
};

export type KernelRyotClientStore = {
	readonly get: (scope: ApiScope) => KernelRyotSession;
};

export const createKernelRyotClientStore = (
	runtime: ClientRuntime,
	theme: ThemeStore,
): KernelRyotClientStore => {
	const sessions = new Map<string, KernelRyotSession>();
	return {
		get: (scope) => {
			const key = apiScopeKey(scope);
			const existing = sessions.get(key);
			if (existing !== undefined) {
				return existing;
			}
			const client = createKernelRyotClient(runtime, scope, theme);
			const session = {
				client,
				runtime: makeRyotRuntime(client),
				hostServices: { runtime, scope },
			};
			sessions.set(key, session);
			return session;
		},
	};
};
