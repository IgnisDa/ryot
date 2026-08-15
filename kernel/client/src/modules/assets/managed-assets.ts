import type { AssetLocator, ManagedAssetLocator } from "@ryot-app/contract/modules/uploads/schemas";
import { Context, Data, Effect, Layer } from "effect";

import { resolveApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { UploadsApi } from "#/api/uploads";

export class ManagedAssetResolutionError extends Data.TaggedError("ManagedAssetResolutionError")<{
	readonly cause: unknown;
}> {}

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

export class ManagedAssetsService extends Context.Service<ManagedAssetsService>()(
	"ManagedAssetsService",
	{
		make: Effect.gen(function* () {
			const api = yield* UploadsApi;
			const resolve = Effect.fn("ManagedAssetsService.resolve")(function* (
				scope: ApiScope,
				assets: readonly ManagedAssetLocator[],
			) {
				if (assets.length === 0) {
					return new Map<string, string>();
				}
				return yield* api.resolveDownloads(scope, { payload: { assets: [...assets] } }).pipe(
					Effect.map(
						(response) =>
							new Map(
								response.map(({ asset, downloadUrl }) => [
									managedAssetKey(asset),
									resolveApiUrl(scope.serverUrl, downloadUrl),
								]),
							),
					),
					Effect.mapError((error) => new ManagedAssetResolutionError({ cause: error.cause })),
				);
			});
			return { resolve };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
