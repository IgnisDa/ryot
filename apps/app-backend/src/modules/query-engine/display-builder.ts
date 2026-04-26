import type { QueryExpression } from "~/lib/query-language";
import type { ViewExpressionTypeInfo } from "~/lib/views/expression-analysis";
import { getPropertyDisplayKind } from "~/lib/views/policy";

export type ResolvedDisplayValue = {
	kind: "boolean" | "date" | "image" | "json" | "null" | "number" | "text";
	value: unknown;
};

export const getLiteralDisplayKind = (
	input: Extract<QueryExpression, { type: "literal" }>,
): ResolvedDisplayValue["kind"] => {
	const { value } = input;
	if (value === null) {
		return "null";
	}

	if (typeof value === "string") {
		return "text";
	}

	if (typeof value === "number") {
		return "number";
	}

	if (typeof value === "boolean") {
		return "boolean";
	}

	return "json";
};

export const getExpressionDisplayKind = (
	typeInfo: ViewExpressionTypeInfo,
): ResolvedDisplayValue["kind"] => {
	if (typeInfo.kind === "null") {
		return "null";
	}

	if (typeInfo.kind === "image") {
		return "image";
	}

	return getPropertyDisplayKind(typeInfo.propertyType);
};
