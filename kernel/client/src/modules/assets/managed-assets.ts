import { AuthRateLimited, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import type {
	PluginAssetBridgeErrorReason,
	PluginAssetOutcome,
	PluginManagedAssetResolution,
} from "@ryot-app/contract/modules/plugins/client";
import {
	type AssetLocator,
	type DownloadResolutionResponse,
	type ManagedAssetLocator,
	UploadBadRequest,
	UploadInternalError,
} from "@ryot-app/contract/modules/uploads/schemas";
import { Context, Data, Effect, Layer, Schema } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { resolveApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { UploadsApi } from "#/api/uploads";

export class ManagedAssetResolutionError extends Data.TaggedError("ManagedAssetResolutionError")<{
	readonly cause: unknown;
}> {}

const isDeclaredFailure = Schema.is(
	Schema.Union([AuthRateLimited, AuthUnauthorized, UploadBadRequest, UploadInternalError]),
);

const classifyManagedAssetCause = (cause: unknown): PluginAssetBridgeErrorReason =>
	isDeclaredFailure(cause) ? "asset-failed" : "transport";

export const classifyManagedAssetFailure = (error: unknown): PluginAssetBridgeErrorReason =>
	error instanceof AuthenticatedApiError ? classifyManagedAssetCause(error.cause) : "transport";

export const managedAssetKey = (asset: ManagedAssetLocator) => `${asset.type}:${asset.key}`;

export const collectManagedAssets = (assets: readonly (AssetLocator | null | undefined)[]) =>
	[
		...new Map(
			assets.flatMap((asset) =>
				asset === null || asset === undefined || asset.type === "remote"
					? []
					: [[managedAssetKey(asset), asset] as const],
			),
		).values(),
	].sort((left, right) => managedAssetKey(left).localeCompare(managedAssetKey(right)));

export const resolveAssetUrl = (asset: AssetLocator, managedUrls: ReadonlyMap<string, string>) =>
	asset.type === "remote" ? asset.url : managedUrls.get(managedAssetKey(asset));

export const mapManagedAssetResolutions = (
	scope: ApiScope,
	response: DownloadResolutionResponse,
): PluginManagedAssetResolution[] =>
	response.map(({ asset, downloadUrl, expiresAt }) => ({
		asset,
		expiresAt,
		url: resolveApiUrl(scope.serverUrl, downloadUrl),
	}));

export class ManagedAssetsService extends Context.Service<ManagedAssetsService>()(
	"ManagedAssetsService",
	{
		make: Effect.gen(function* () {
			const api = yield* UploadsApi;
			const read = Effect.fn("ManagedAssetsService.read")(function* (
				scope: ApiScope,
				assets: readonly ManagedAssetLocator[],
			) {
				if (assets.length === 0) {
					return [];
				}
				return yield* api.resolveDownloads(scope, { payload: { assets: [...assets] } }).pipe(
					Effect.map((response) => mapManagedAssetResolutions(scope, response)),
					Effect.mapError((error) => new ManagedAssetResolutionError({ cause: error.cause })),
				);
			});
			const resolve = Effect.fn("ManagedAssetsService.resolve")(function* (
				scope: ApiScope,
				assets: readonly ManagedAssetLocator[],
			) {
				const resolutions = yield* read(scope, assets);
				return new Map(resolutions.map(({ asset, url }) => [managedAssetKey(asset), url] as const));
			});
			return { read, resolve };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const resolveManagedAssetOutcome = (
	scope: ApiScope,
	assets: readonly ManagedAssetLocator[],
): Effect.Effect<PluginAssetOutcome, never, ManagedAssetsService> =>
	ManagedAssetsService.pipe(
		Effect.flatMap((service) => service.read(scope, assets)),
		Effect.match({
			onSuccess: (resolutions) => ({ outcome: "success", resolutions }) as const,
			onFailure: (error) =>
				({ outcome: "failure", reason: classifyManagedAssetCause(error.cause) }) as const,
		}),
	);
