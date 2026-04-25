import type {
	AssetLocator,
	DownloadResolutionResponse,
	ManagedAssetLocator,
} from "@ryot/contract/modules/uploads/schemas";
import type { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

import type { ApiScope } from "@/api/request-key";

export type ManagedAssetResolutionState =
	| { readonly status: "ready"; readonly urls: ReadonlyMap<string, string> }
	| { readonly status: "loading"; readonly urls: ReadonlyMap<string, string> }
	| {
			readonly status: "unavailable";
			readonly cause: Cause.Cause<unknown>;
			readonly urls: ReadonlyMap<string, string>;
	  };

export type ManagedAssetResolutionRequest = {
	readonly scope: ApiScope;
	readonly assets: readonly ManagedAssetLocator[];
};

export const managedAssetKey = (asset: ManagedAssetLocator) => `${asset.type}:${asset.key}`;

export const assetLocatorKey = (asset: AssetLocator) =>
	asset.type === "remote" ? `remote:${asset.url}` : managedAssetKey(asset);

export const canonicalManagedAssets = (assets: readonly ManagedAssetLocator[]) =>
	[...new Map(assets.map((asset) => [managedAssetKey(asset), asset])).values()].sort(
		(left, right) => managedAssetKey(left).localeCompare(managedAssetKey(right)),
	);

export const resolvedAssetUrls = (
	response: DownloadResolutionResponse,
	resolveUrl: (url: string) => string,
) =>
	new Map(
		response.map(({ asset, downloadUrl }) => [managedAssetKey(asset), resolveUrl(downloadUrl)]),
	);

export const resolveAssetUrl = (asset: AssetLocator, managedUrls: ReadonlyMap<string, string>) =>
	asset.type === "remote" ? asset.url : managedUrls.get(managedAssetKey(asset));

export const mapManagedAssetResolution = (
	result: AsyncResult.AsyncResult<DownloadResolutionResponse, unknown>,
	resolveUrl: (url: string) => string,
): ManagedAssetResolutionState => {
	if (AsyncResult.isSuccess(result)) {
		return { status: "ready", urls: resolvedAssetUrls(result.value, resolveUrl) };
	}
	if (AsyncResult.isFailure(result)) {
		return { status: "unavailable", cause: result.cause, urls: new Map() };
	}
	return { status: "loading", urls: new Map() };
};
