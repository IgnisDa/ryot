import type { AppPropertyDefinition, AppPropertyPrimitiveType } from "@ryot/ts-utils";
import { match } from "ts-pattern";

import type { PropertyType } from "./reference";

export type ViewPropertyDisplayKind = "date" | "text" | "json" | "number" | "boolean";

const containsPropertyTypes = new Set<PropertyType>(["array", "object", "string", "enum-array"]);

const propertyDisplayKinds = {
	date: "date",
	enum: "text",
	array: "json",
	object: "json",
	string: "text",
	datetime: "date",
	number: "number",
	integer: "number",
	boolean: "boolean",
	"enum-array": "json",
} satisfies Record<PropertyType, ViewPropertyDisplayKind>;

export const getComparablePropertyType = (
	property: Pick<AppPropertyDefinition, "type">,
): AppPropertyPrimitiveType | undefined =>
	match(property.type)
		.with("boolean", "date", "datetime", "integer", "number", "string", (type) => type)
		.with("enum", () => "string" as const)
		.otherwise(() => undefined);

export const supportsComparableFilter = (propertyType: PropertyType) => {
	return getComparablePropertyType({ type: propertyType }) !== undefined;
};

export const supportsContainsFilter = (propertyType: PropertyType) => {
	return containsPropertyTypes.has(propertyType);
};

export const getPropertyDisplayKind = (propertyType: PropertyType): ViewPropertyDisplayKind =>
	propertyDisplayKinds[propertyType];
