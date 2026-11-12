import { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { isObjectRecord, isUnknownArray } from "@ryot-app/ts-utils/predicates";
import { Schema } from "effect";

export const managedAssetLocators = (value: unknown): readonly ManagedAssetLocator[] => {
	const found = new Map<string, ManagedAssetLocator>();
	const isLocator = Schema.is(ManagedAssetLocator);
	const visit = (child: unknown): void => {
		if (isLocator(child)) {
			found.set(`${child.type}\0${child.key}`, child);
		} else if (isUnknownArray(child)) {
			child.forEach(visit);
		} else if (isObjectRecord(child)) {
			Object.values(child).forEach(visit);
		}
	};
	visit(value);
	return [...found.values()];
};
