import { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Schema } from "effect";

const isManagedAssetLocator = Schema.is(ManagedAssetLocator);

export const managedAssetLocatorKey = (locator: ManagedAssetLocator) =>
	`${locator.type}:${locator.key}`;

export type ManagedAssetPropertyRecord = {
	readonly propertiesSchema: AppSchema;
	readonly properties: Readonly<Record<string, unknown>>;
};

const collectPropertyAssets = (
	property: AppPropertyDefinition,
	value: unknown,
	assets: ManagedAssetLocator[],
	includeSecrets: boolean,
) => {
	if (property.secret === true && !includeSecrets) {
		return;
	}
	if (property.type === "object") {
		if (property.validation?.asset && isObjectRecord(value)) {
			if (isManagedAssetLocator(value)) {
				assets.push({ key: value.key, type: value.type });
			}
			return;
		}
		if (isObjectRecord(value)) {
			for (const [key, child] of Object.entries(property.properties)) {
				collectPropertyAssets(child, value[key], assets, includeSecrets);
			}
		}
		return;
	}
	if (property.type === "array" && Array.isArray(value)) {
		for (const item of value) {
			collectPropertyAssets(property.items, item, assets, includeSecrets);
		}
	}
};

export const collectManagedAssetLocatorsInto = (
	records: ReadonlyArray<ManagedAssetPropertyRecord>,
	collected: Map<string, ManagedAssetLocator>,
	includeSecrets = false,
) => {
	const assets: ManagedAssetLocator[] = [];
	for (const { properties, propertiesSchema } of records) {
		for (const [key, property] of Object.entries(propertiesSchema.fields)) {
			collectPropertyAssets(property, properties[key], assets, includeSecrets);
		}
	}
	for (const asset of assets) {
		collected.set(managedAssetLocatorKey(asset), asset);
	}
};

export const sortedManagedAssetLocators = (collected: ReadonlyMap<string, ManagedAssetLocator>) =>
	[...collected.values()].sort((left, right) =>
		managedAssetLocatorKey(left).localeCompare(managedAssetLocatorKey(right)),
	);

export const collectManagedAssetLocators = (
	records: ReadonlyArray<ManagedAssetPropertyRecord>,
	includeSecrets = false,
): ReadonlyArray<ManagedAssetLocator> => {
	const collected = new Map<string, ManagedAssetLocator>();
	collectManagedAssetLocatorsInto(records, collected, includeSecrets);
	return sortedManagedAssetLocators(collected);
};
