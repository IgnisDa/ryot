import type {
	AppPropertyDefinition,
	AppPropertyPrimitiveType,
} from "@ryot/ts-utils";
import { match } from "ts-pattern";
import type { PropertyType } from "./reference";

export type ViewPropertyDisplayKind =
	| "date"
	| "text"
	| "json"
	| "number"
	| "boolean";

const comparablePropertyTypes = new Set<AppPropertyPrimitiveType>([
	"date",
	"number",
	"string",
	"boolean",
	"integer",
	"datetime",
]);

const containsPropertyTypes = new Set<PropertyType>([
	"array",
	"object",
	"string",
]);

export const getComparablePropertyType = (
	property: Pick<AppPropertyDefinition, "type">,
): AppPropertyPrimitiveType | undefined => {
	if (comparablePropertyTypes.has(property.type as AppPropertyPrimitiveType)) {
		return property.type as AppPropertyPrimitiveType;
	}

	return undefined;
};

export const supportsComparableFilter = (propertyType: PropertyType) => {
	return comparablePropertyTypes.has(propertyType as AppPropertyPrimitiveType);
};

export const supportsContainsFilter = (propertyType: PropertyType) => {
	return containsPropertyTypes.has(propertyType);
};

export const getPropertyDisplayKind = (
	propertyType: PropertyType,
): ViewPropertyDisplayKind => {
	return match(propertyType)
		.with("date", () => "date" as const)
		.with("datetime", () => "date" as const)
		.with("boolean", () => "boolean" as const)
		.with("array", () => "json" as const)
		.with("object", () => "json" as const)
		.with("integer", () => "number" as const)
		.with("number", () => "number" as const)
		.otherwise(() => "text" as const);
};

export const getCommonSortPropertyType = (propertyTypes: PropertyType[]) => {
	const uniqueTypes = [...new Set(propertyTypes)];
	const firstType = uniqueTypes[0];
	if (!firstType) {
		return "string" satisfies PropertyType;
	}

	if (uniqueTypes.length === 1) {
		return firstType;
	}

	if (
		uniqueTypes.every((propertyType) =>
			["integer", "number"].includes(propertyType),
		)
	) {
		return "number" satisfies PropertyType;
	}

	return "string" satisfies PropertyType;
};
