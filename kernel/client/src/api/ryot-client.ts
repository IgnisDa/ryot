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
	TemporaryUploads,
} from "#/modules/assets/temporary-uploads";
import { EntityInterestService } from "#/modules/entity-interest/service";
import type { ThemeStore } from "#/modules/theme/store";
import type { ClientRuntime } from "#/runtime";

type KernelApiRuntime = {
	readonly runSync: <A>(
		effect: Effect.Effect<
			A,
			never,
			EntityInterestService | CollectionsApi | RyotQLApi | UploadsApi | TemporaryUploads
		>,
	) => A;
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
		query: (document) =>
			runtime
				.runSync(RyotQLApi)
				.execute(scope, { payload: document })
				.pipe(Effect.mapError((error) => new RyotClientError(classifyRyotQLFailure(error)))),
		uploadTemporary: (request) =>
			runtime
				.runSync(TemporaryUploads)
				.upload(scope, request)
				.pipe(
					Effect.mapError((error) => new RyotClientError(classifyTemporaryUploadFailure(error))),
				),
		resolveAssets: (assets) =>
			runtime
				.runSync(UploadsApi)
				.resolveDownloads(scope, { payload: { assets: [...assets] } })
				.pipe(
					Effect.map((response) => mapManagedAssetResolutions(scope, response)),
					Effect.mapError((error) => new RyotClientError(classifyManagedAssetFailure(error))),
				),
		mutateCollection: (request) => {
			const api = runtime.runSync(CollectionsApi);
			return Effect.gen(function* () {
				if (request.action === "create") {
					return yield* api.create(scope, { payload: request.input });
				}
				if (request.action === "upsert-membership") {
					return yield* api.createMembership(scope, { payload: request.input });
				}
				return yield* api.deleteMembership(scope, { payload: request.input });
			}).pipe(
				Effect.map((value): unknown => value),
				Effect.mapError((error) => new RyotClientError(classifyCollectionFailure(error))),
			);
		},
	});
};

export type KernelRyotClient = ReturnType<typeof createKernelRyotClient>;

export type KernelRyotSession = {
	readonly runtime: RyotRuntime;
	readonly client: KernelRyotClient;
	readonly hostServices: KernelHostServices;
};

export type KernelRyotClientStore = { readonly get: (scope: ApiScope) => KernelRyotSession };

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
				hostServices: { scope, runtime },
			};
			sessions.set(key, session);
			return session;
		},
	};
};
