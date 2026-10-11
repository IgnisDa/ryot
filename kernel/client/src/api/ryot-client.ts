import {
	createRyotClient,
	type RyotClientAdapter,
	RyotClientError,
} from "@ryot-app/plugin-client-sdk";
import { Effect } from "effect";

import { classifyCollectionFailure, CollectionsApi } from "#/api/collections";
import { classifyRyotQLFailure, RyotQLApi } from "#/api/ryotql";
import { type ApiScope, apiScopeKey } from "#/api/scope";
import { UploadsApi } from "#/api/uploads";
import type { KernelHostServices } from "#/host-services";
import {
	classifyManagedAssetFailure,
	mapManagedAssetResolutions,
} from "#/modules/assets/managed-assets";
import { classifyUploadFailure, Uploads } from "#/modules/assets/uploads";
import { EntityWatchService } from "#/modules/entity-watches/service";
import { ExternalLinks } from "#/modules/external-links/service";
import type { ThemeStore } from "#/modules/theme/store";
import type { ClientRuntime } from "#/runtime";

type KernelApiRuntime = {
	readonly runSync: <A>(
		effect: Effect.Effect<
			A,
			never,
			EntityWatchService | CollectionsApi | RyotQLApi | UploadsApi | Uploads
		>,
	) => A;
};

export const createKernelRyotClient = (
	runtime: KernelApiRuntime,
	scope: ApiScope,
	theme: ThemeStore,
	openExternalLink?: RyotClientAdapter["openExternalLink"],
) => {
	return createRyotClient({
		theme,
		openExternalLink,
		watchEntities: (interest, onUpdate) =>
			runtime.runSync(
				Effect.map(EntityWatchService, (service) => service.watch(scope, interest, onUpdate)),
			),
		upload: (request) =>
			runtime
				.runSync(Uploads)
				.upload(scope, request)
				.pipe(Effect.mapError((error) => new RyotClientError(classifyUploadFailure(error)))),
		query: (document) =>
			runtime
				.runSync(RyotQLApi)
				.execute(scope, { payload: document })
				.pipe(Effect.mapError((error) => new RyotClientError(classifyRyotQLFailure(error)))),
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

export type KernelRyotClientEntry = {
	readonly client: KernelRyotClient;
	readonly hostServices: KernelHostServices;
};

export type KernelRyotClientStore = { readonly get: (scope: ApiScope) => KernelRyotClientEntry };

export const createKernelRyotClientStore = (
	runtime: ClientRuntime,
	theme: ThemeStore,
): KernelRyotClientStore => {
	let last: { readonly key: string; readonly entry: KernelRyotClientEntry } | undefined;
	return {
		get: (scope) => {
			const key = apiScopeKey(scope);
			if (last?.key === key) {
				return last.entry;
			}
			const client = createKernelRyotClient(
				runtime,
				scope,
				theme,
				runtime.runSync(ExternalLinks).open,
			);
			const entry = { client, hostServices: { scope, runtime } };
			last = { key, entry };
			return entry;
		},
	};
};
