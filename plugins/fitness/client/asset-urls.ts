import type { AssetLocator, ManagedAssetLocator } from "@ryot-app/client-sdk";
import { managedAssetKey, useManagedAssetUrl } from "@ryot-app/client-sdk/react";

export const managedAssetBatch = (assets: readonly (AssetLocator | undefined)[]) => {
	const managed = assets.filter(
		(asset): asset is ManagedAssetLocator => asset !== undefined && asset.type !== "remote",
	);
	return [...new Map(managed.map((asset) => [managedAssetKey(asset), asset])).values()].sort(
		(left, right) => managedAssetKey(left).localeCompare(managedAssetKey(right)),
	);
};

export const useAssetUrl = (asset: AssetLocator | undefined) => {
	const managedUrl = useManagedAssetUrl(asset?.type === "remote" ? undefined : asset);
	return asset?.type === "remote" ? asset.url : managedUrl;
};
