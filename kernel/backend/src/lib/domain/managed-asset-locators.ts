import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";

type JsonObject = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonObject => isObjectRecord(value);

const assetKey = (locator: ManagedAssetLocator) => `${locator.type}:${locator.key}`;

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
		if (property.validation?.asset && isJsonObject(value)) {
			if (
				(value["type"] === "local" || value["type"] === "s3") &&
				typeof value["key"] === "string"
			) {
				assets.push({ key: value["key"], type: value["type"] });
			}
			return;
		}
		if (isJsonObject(value)) {
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
		collected.set(assetKey(asset), asset);
	}
};

export const sortedManagedAssetLocators = (collected: ReadonlyMap<string, ManagedAssetLocator>) =>
	[...collected.values()].sort((left, right) => assetKey(left).localeCompare(assetKey(right)));

export const collectManagedAssetLocators = (
	records: ReadonlyArray<ManagedAssetPropertyRecord>,
	includeSecrets = false,
): ReadonlyArray<ManagedAssetLocator> => {
	const collected = new Map<string, ManagedAssetLocator>();
	collectManagedAssetLocatorsInto(records, collected, includeSecrets);
	return sortedManagedAssetLocators(collected);
};
