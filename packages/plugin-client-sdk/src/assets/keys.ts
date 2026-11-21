import {
	type AssetLocator,
	MANAGED_ASSET_RESOLUTION_MAX_ASSETS,
	type ManagedAssetLocator,
} from "@ryot-app/contract/modules/assets/schemas";

export const managedAssetKey = (locator: ManagedAssetLocator) => `${locator.type}:${locator.key}`;

export const assetKey = (locator: AssetLocator) =>
	locator.type === "remote" ? `remote:${locator.url}` : managedAssetKey(locator);

export const collectManagedAssetLocators = (assets: readonly (undefined | AssetLocator)[]) =>
	sortedManagedAssetLocators([
		...new Map(
			assets.flatMap((asset) =>
				asset === undefined || asset.type === "remote"
					? []
					: [[managedAssetKey(asset), { key: asset.key, type: asset.type }]],
			),
		).values(),
	]);

const sortedManagedAssetLocators = (locators: readonly ManagedAssetLocator[]) =>
	[...locators].sort((left, right) => managedAssetKey(left).localeCompare(managedAssetKey(right)));

export const canonicalAssetBatchKey = (locators: readonly ManagedAssetLocator[]) =>
	JSON.stringify(sortedManagedAssetLocators(locators));

export type ManagedAssetBatch = {
	readonly key: string;
	readonly locators: readonly ManagedAssetLocator[];
};

export const managedAssetBatches = (
	locators: readonly ManagedAssetLocator[],
): readonly ManagedAssetBatch[] => {
	const deduped = collectManagedAssetLocators(locators);
	const batches: ManagedAssetBatch[] = [];
	for (let index = 0; index < deduped.length; index += MANAGED_ASSET_RESOLUTION_MAX_ASSETS) {
		const slice = deduped.slice(index, index + MANAGED_ASSET_RESOLUTION_MAX_ASSETS);
		batches.push({ locators: slice, key: canonicalAssetBatchKey(slice) });
	}
	return batches;
};
