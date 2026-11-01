import {
	MANAGED_ASSET_RESOLUTION_MAX_ASSETS,
	type ManagedAssetLocator,
} from "@ryot-app/contract/modules/assets/schemas";

export const managedAssetKey = (locator: ManagedAssetLocator) => `${locator.type}:${locator.key}`;

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
	const deduped = sortedManagedAssetLocators([
		...new Map(locators.map((locator) => [managedAssetKey(locator), locator])).values(),
	]);
	const batches: ManagedAssetBatch[] = [];
	for (let index = 0; index < deduped.length; index += MANAGED_ASSET_RESOLUTION_MAX_ASSETS) {
		const slice = deduped.slice(index, index + MANAGED_ASSET_RESOLUTION_MAX_ASSETS);
		batches.push({ locators: slice, key: canonicalAssetBatchKey(slice) });
	}
	return batches;
};
