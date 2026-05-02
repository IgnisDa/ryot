import type { ManagedAssetLocator } from "@ryot/contract/modules/uploads/schemas";

export const managedAssetKey = (asset: ManagedAssetLocator) => `${asset.type}:${asset.key}`;

export const canonicalManagedAssets = (assets: readonly ManagedAssetLocator[]) =>
	[...new Map(assets.map((asset) => [managedAssetKey(asset), asset])).values()].sort(
		(left, right) => managedAssetKey(left).localeCompare(managedAssetKey(right)),
	);
